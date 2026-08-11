import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { unzipSync } from 'fflate'

const checkedAt = '2026-08-11'
const dataVersion = '2026-01-15'
const amanoPage = 'https://amano-tec.com/data/localgovernments.html'
const amanoDownload = 'https://amano-tec.com/data/download.php'
const digitalAgencyCsv = 'https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/2b1128e2-c699-4aa0-9206-37169a6697c8/3d2142af/20260630_resources_opendata_lg_list_02.csv'
const digitalAgencyPage = 'https://www.digital.go.jp/resources/data_local_governments'
const jlisAddressPage = 'https://www.j-lis.go.jp/spd/code-address/jititai-code.html'
const jlisMapPage = 'https://www.j-lis.go.jp/spd/map-search/cms_1069.html'
const outputDirectory = resolve('public/data/government')
const cacheDirectory = join(tmpdir(), 'imakoko-government-20260115')

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      field = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else field += character
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [headers, ...values] = rows
  return values.map((columns) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ''), columns[index] ?? ''])))
}

function normalizedCode(value) {
  return value.replace(/\D/g, '').slice(0, 5).replace(/^0+/, '')
}

function paddedCode(value) {
  return normalizedCode(value).padStart(5, '0')
}

function safeHttps(value) {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

async function cachedDownload(name, request) {
  await mkdir(cacheDirectory, { recursive: true })
  const path = join(cacheDirectory, name)
  try {
    return await readFile(path)
  } catch {
    const response = await fetch(request)
    if (!response.ok) throw new Error(`データ取得に失敗しました: ${response.status} ${name}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(path, bytes)
    return bytes
  }
}

async function loadOfficeRows() {
  const body = new URLSearchParams({
    name: '', email: '', org: '', usage: '非商用の静的PWAで役所距離表示に利用',
    mail_set: 'confirm_submit', filenumber: '3', x: '10', y: '10', httpReferer: amanoPage
  })
  const zip = await cachedDownload('local-governments.zip', new Request(amanoDownload, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: 'https://amano-tec.com/data/download.html' },
    body
  }))
  const entries = unzipSync(zip)
  const entry = Object.entries(entries).find(([name]) => name.endsWith('_utf8.csv'))
  if (!entry) throw new Error('全国役所ZIP内にUTF-8データがありません')
  const text = new TextDecoder().decode(entry[1]).replace(/^\uFEFF/, '')
  const [header, ...lines] = text.trim().split(/\r?\n/)
  const headers = header.split('\t')
  return lines.map((line) => Object.fromEntries(headers.map((name, index) => [name, line.split('\t')[index] ?? ''])))
}

async function loadOfficialUrlRows() {
  const bytes = await cachedDownload('digital-agency-local-governments.csv', digitalAgencyCsv)
  return parseCsv(new TextDecoder().decode(bytes))
}

function officeType(row) {
  const code = paddedCode(row.jiscode)
  if (code.endsWith('000')) return 'prefectural'
  if (row.building.includes('区役所')) return 'ward'
  if (row.building.includes('町役場')) return 'town'
  if (row.building.includes('村役場')) return 'village'
  return 'city'
}

async function main() {
  const [officeRows, officialRows, municipalityData] = await Promise.all([
    loadOfficeRows(),
    loadOfficialUrlRows(),
    readFile(resolve('src/data/municipalities.generated.json'), 'utf8').then(JSON.parse)
  ])
  const officialByCode = new Map(officialRows.map((row) => [normalizedCode(row['団体コード']), row]))
  const ownOfficialUrl = (code) => {
    const row = officialByCode.get(normalizedCode(code))
    if (!row) return undefined
    return [
      row['自治体サイトのオープンデータページURL'],
      row['オープンデータ掲載サイトのURL1'],
      row['オープンデータ掲載サイトのURL2'],
      row['オープンデータ掲載サイトのURL3']
    ].map(safeHttps).find(Boolean)
  }
  const officialUrl = (code, type) => {
    const padded = paddedCode(code)
    const parentCode = `${padded.slice(0, 3)}00`
    const prefectureCode = `${padded.slice(0, 2)}000`
    return ownOfficialUrl(code) ||
      (type === 'ward' ? ownOfficialUrl(parentCode) : undefined) ||
      ownOfficialUrl(prefectureCode) ||
      jlisMapPage
  }

  const records = officeRows.map((row) => {
    const type = officeType(row)
    const code = type === 'prefectural'
      ? paddedCode(row.jiscode).slice(0, 2).replace(/^0+/, '')
      : normalizedCode(row.jiscode)
    const latitude = Number(row.lat)
    const longitude = Number(row.long)
    if (!code || !row.building || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < 20 || latitude > 50 || longitude < 120 || longitude > 155) {
      throw new Error(`役所レコードが不正です: ${row.jiscode} ${row.building}`)
    }
    return {
      id: `${code}-${type}`,
      municipalityCode: code,
      officeType: type,
      name: row.building,
      coordinates: { latitude, longitude },
      officialUrl: officialUrl(code, type),
      sourceAddress: row.address,
      sourceUrl: amanoPage,
      checkedAt
    }
  })

  const knownCodeAliases = { '4423': '4216' }
  for (const [code, sourceCode] of Object.entries(knownCodeAliases)) {
    const source = records.find((record) => record.municipalityCode === sourceCode)
    if (source) records.push({ ...source, id: `${code}-${source.officeType}`, municipalityCode: code })
  }
  records.sort((left, right) => left.id.localeCompare(right.id))

  const recordCodes = new Set(records.filter((record) => record.officeType !== 'prefectural').map((record) => record.municipalityCode))
  const currentCodes = new Set(Object.keys(municipalityData.records))
  const missingCurrentCodes = [...currentCodes].filter((code) => !recordCodes.has(code)).sort()
  const extraOfficeCodes = [...recordCodes].filter((code) => !currentCodes.has(code)).sort()
  const fallbackOfficialCount = records.filter((record) => record.officialUrl === jlisMapPage).length

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'offices.json'), `${JSON.stringify(records)}\n`, 'utf8')
  const manifest = {
    dataVersion,
    checkedAt,
    schemaVersion: 1,
    recordCount: records.length,
    localOfficeCount: recordCodes.size,
    currentMunicipalityCount: currentCodes.size,
    missingCurrentCodes,
    extraOfficeCodes,
    fallbackOfficialCount,
    sourceUrls: [amanoPage, digitalAgencyPage, digitalAgencyCsv, jlisAddressPage, jlisMapPage],
    redistribution: 'アマノ技研データ同梱readme: フリーソフト・転載配布可'
  }
  await writeFile(join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
}

await main()
