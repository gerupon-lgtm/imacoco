import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { unzipSync } from 'fflate'

const dataVersion = '2026-06-01'
const sourcePage = 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html'
const sources = [
  ['hospital', 'https://www.mhlw.go.jp/content/11121000/01-1_hospital_facility_info_20260601.csv.zip'],
  ['clinic', 'https://www.mhlw.go.jp/content/11121000/02-1_clinic_facility_info_20260601.csv.zip'],
  ['dental', 'https://www.mhlw.go.jp/content/11121000/03-1_dental_facility_info_20260601.csv.zip'],
  ['midwifery', 'https://www.mhlw.go.jp/content/11121000/04_maternity_home_20260601.csv.zip'],
  ['pharmacy', 'https://www.mhlw.go.jp/content/11121000/05_pharmacy_20260601.csv.zip']
]

const outputDirectory = resolve('public/data/medical')
const cacheDirectory = join(tmpdir(), `imakoko-medical-${dataVersion.replaceAll('-', '')}`)

function parseCsv(text, visit) {
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      field = ''
      if (row.some((value) => value.length > 0)) visit(row)
      row = []
    } else {
      field += character
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    visit(row)
  }
}

function safeHttpsUrl(value) {
  const candidate = value.trim()
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function gridId(latitude, longitude) {
  return `${Math.floor(latitude * 4)}-${Math.floor(longitude * 4)}`
}

async function download(url) {
  await mkdir(cacheDirectory, { recursive: true })
  const cachedPath = join(cacheDirectory, basename(url))
  try {
    return await readFile(cachedPath)
  } catch {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`医療データを取得できませんでした: ${response.status} ${basename(url)}`)
    const body = Buffer.from(await response.arrayBuffer())
    await writeFile(cachedPath, body)
    return body
  }
}

function extractCsv(zipBytes) {
  const entries = unzipSync(zipBytes)
  const entry = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.csv'))
  if (!entry) throw new Error('ZIP内にCSVがありません')
  return new TextDecoder('utf-8').decode(entry[1]).replace(/^\uFEFF/, '')
}

function recordFromRow(type, row, indexes, accounting) {
  const id = row[indexes.id]?.trim()
  const name = row[indexes.name]?.trim()
  const latitude = Number(row[indexes.latitude])
  const longitude = Number(row[indexes.longitude])
  const prefectureCode = row[indexes.prefectureCode]?.trim().padStart(2, '0')
  const municipalityPart = row[indexes.municipalityCode]?.trim().padStart(3, '0')

  if (!id || !name) {
    accounting.invalidIdentity += 1
    return undefined
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 20 || latitude > 50 || longitude < 120 || longitude > 155) {
    accounting.invalidCoordinates += 1
    return undefined
  }
  if (!/^\d{2}$/.test(prefectureCode) || !/^\d{3}$/.test(municipalityPart)) {
    accounting.invalidMunicipality += 1
    return undefined
  }

  const officialUrl = safeHttpsUrl(row[indexes.officialUrl] ?? '')
  if ((row[indexes.officialUrl] ?? '').trim() && !officialUrl) accounting.invalidOfficialUrl += 1
  return {
    id,
    type,
    name,
    coordinates: { latitude, longitude },
    ...(officialUrl ? { officialUrl } : {}),
    prefectureCode,
    municipalityCode: `${prefectureCode}${municipalityPart}`,
    sourceUpdatedAt: dataVersion
  }
}

async function main() {
  const shards = new Map()
  const seenIds = new Set()
  const accounting = {
    sourceRecords: 0,
    generatedRecords: 0,
    invalidIdentity: 0,
    invalidCoordinates: 0,
    invalidMunicipality: 0,
    invalidOfficialUrl: 0,
    duplicateId: 0
  }
  const facilityCounts = { hospital: 0, clinic: 0, dental: 0, pharmacy: 0, midwifery: 0 }

  for (const [type, url] of sources) {
    const csv = extractCsv(await download(url))
    let headers
    parseCsv(csv, (row) => {
      if (!headers) {
        headers = row
        return
      }
      accounting.sourceRecords += 1
      const nameHeader = type === 'pharmacy' ? '名称' : '正式名称'
      const urlHeader = type === 'pharmacy' ? '薬局のホームページアドレス' : '案内用ホームページアドレス'
      const indexes = {
        id: headers.indexOf('ID'),
        name: headers.indexOf(nameHeader),
        prefectureCode: headers.indexOf('都道府県コード'),
        municipalityCode: headers.indexOf('市区町村コード'),
        latitude: headers.indexOf('所在地座標（緯度）'),
        longitude: headers.indexOf('所在地座標（経度）'),
        officialUrl: headers.indexOf(urlHeader)
      }
      if (Object.values(indexes).some((index) => index < 0)) throw new Error(`${type} CSVの必須列がありません`)
      const record = recordFromRow(type, row, indexes, accounting)
      if (!record) return
      if (seenIds.has(record.id)) {
        accounting.duplicateId += 1
        return
      }
      seenIds.add(record.id)
      facilityCounts[type] += 1
      accounting.generatedRecords += 1
      const key = gridId(record.coordinates.latitude, record.coordinates.longitude)
      const shard = shards.get(key) ?? []
      shard.push(record)
      shards.set(key, shard)
    })
  }

  const accounted = accounting.generatedRecords + accounting.invalidIdentity + accounting.invalidCoordinates +
    accounting.invalidMunicipality + accounting.duplicateId
  if (accounted !== accounting.sourceRecords) {
    throw new Error(`原典件数と採用・除外件数が一致しません: ${accounting.sourceRecords} != ${accounted}`)
  }

  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true })
  const checksum = createHash('sha256')
  const grids = {}
  for (const key of [...shards.keys()].sort()) {
    const records = shards.get(key).sort((left, right) => left.id.localeCompare(right.id))
    const json = `${JSON.stringify(records)}\n`
    grids[key] = records.length
    checksum.update(key).update('\0').update(json)
    await writeFile(join(outputDirectory, `${key}.json`), json, 'utf8')
  }

  const manifest = {
    dataVersion,
    schemaVersion: 1,
    gridSizeDegrees: 0.25,
    facilityCounts,
    grids,
    accounting,
    generatedAt: new Date().toISOString(),
    sourceUrls: [sourcePage, ...sources.map(([, url]) => url)],
    license: '公共データ利用規約（第1.0版）',
    checksum: checksum.digest('hex')
  }
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ...accounting, facilityCounts, shardCount: shards.size, checksum: manifest.checksum }, null, 2)}\n`)
}

await main()
