import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { unzipSync } from 'fflate'

const SOURCE_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/N05/N05-25/N05-25_GML.zip'
const SOURCE_ENTRY = 'N05-25_GML/UTF-8/N05-25_Station2.geojson'
const DATA_VERSION = '2025-12-31'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = resolve(root, 'public/data/stations')
const archivePath = resolve(tmpdir(), 'N05-25_GML.zip')

try {
  await access(archivePath)
} catch {
  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Station source returned HTTP ${response.status}`)
  await writeFile(archivePath, new Uint8Array(await response.arrayBuffer()))
}

const archive = unzipSync(new Uint8Array(await readFile(archivePath)), (file) => file.name === SOURCE_ENTRY)
const stationBytes = archive[SOURCE_ENTRY]
if (!stationBytes) throw new Error(`Missing ${SOURCE_ENTRY} in source archive`)
const source = JSON.parse(new TextDecoder().decode(stationBytes))
if (!Array.isArray(source.features) || source.features.length < 20_000) {
  throw new Error(`Unexpected station feature count: ${source.features?.length}`)
}

const radians = (degrees) => degrees * Math.PI / 180
const distanceMeters = (left, right) => {
  const latitudeDelta = radians(right.latitude - left.latitude)
  const longitudeDelta = radians(right.longitude - left.longitude)
  const halfChord = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_008.8 * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord))
}
const normalizeName = (name) => name.normalize('NFKC').replace(/[\s　]+/g, '').replace(/駅$/, '')
const gridId = ({ latitude, longitude }) => `${Math.floor(latitude * 4)}-${Math.floor(longitude * 4)}`

const excluded = { ended: 0, suspended: 0, invalid: 0 }
const currentRecords = []
for (const feature of source.features) {
  const properties = feature.properties ?? {}
  const coordinates = feature.geometry?.coordinates
  if (properties.N05_005e !== '9999') {
    excluded.ended += 1
    continue
  }
  if (`${properties.N05_008 ?? ''} ${properties.N05_009 ?? ''}`.includes('休止')) {
    excluded.suspended += 1
    continue
  }
  if (
    feature.geometry?.type !== 'Point' ||
    !Array.isArray(coordinates) ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1]) ||
    !properties.N05_006 ||
    !properties.N05_011
  ) {
    excluded.invalid += 1
    continue
  }
  currentRecords.push({
    id: properties.N05_006,
    name: properties.N05_011,
    coordinates: { latitude: coordinates[1], longitude: coordinates[0] },
    lineName: properties.N05_002 ?? '路線情報なし',
    operatorName: properties.N05_003 ?? '運営会社情報なし',
    operatorType: properties.N05_001 ?? '不明',
    installedStartYear: Number(properties.N05_005b ?? properties.N05_004 ?? 999),
    sourceNote: [properties.N05_008, properties.N05_009].filter(Boolean).join(' / ')
  })
}

const groupedByName = new Map()
for (const record of currentRecords.sort((left, right) => left.id.localeCompare(right.id, 'ja'))) {
  const key = normalizeName(record.name)
  const clusters = groupedByName.get(key) ?? []
  const cluster = clusters.find((candidate) => distanceMeters(candidate.representative, record.coordinates) < 200)
  if (cluster) cluster.records.push(record)
  else clusters.push({ representative: record.coordinates, records: [record] })
  groupedByName.set(key, clusters)
}

const stationGroups = []
for (const [normalizedName, clusters] of groupedByName) {
  for (const cluster of clusters) {
    const members = cluster.records
    const relationIds = members.map((member) => member.id).sort((a, b) => a.localeCompare(b, 'ja'))
    const lines = [...new Map(members.map((member) => [
      `${member.lineName}\u0000${member.operatorName}\u0000${member.operatorType}`,
      { lineName: member.lineName, operatorName: member.operatorName, operatorType: member.operatorType }
    ])).values()].sort((left, right) =>
      `${left.lineName}\u0000${left.operatorName}`.localeCompare(`${right.lineName}\u0000${right.operatorName}`, 'ja')
    )
    const idHash = createHash('sha256').update(`${normalizedName}\u0000${relationIds.join('\u0000')}`).digest('hex').slice(0, 16)
    stationGroups.push({
      id: `station-${idHash}`,
      name: members[0].name,
      coordinates: {
        latitude: Number((members.reduce((sum, member) => sum + member.coordinates.latitude, 0) / members.length).toFixed(6)),
        longitude: Number((members.reduce((sum, member) => sum + member.coordinates.longitude, 0) / members.length).toFixed(6))
      },
      lines,
      sourceRelationIds: relationIds,
      installedStartYear: Math.min(...members.map((member) => member.installedStartYear)),
      installedEndYear: 9999,
      ...(members.some((member) => member.sourceNote) ? { sourceNote: members.map((member) => member.sourceNote).filter(Boolean).join(' / ') } : {}),
      dataVersion: DATA_VERSION
    })
  }
}

const shards = new Map()
for (const station of stationGroups) {
  const id = gridId(station.coordinates)
  const shard = shards.get(id) ?? []
  shard.push(station)
  shards.set(id, shard)
}

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })
const checksum = createHash('sha256')
const gridCounts = {}
for (const [id, stations] of [...shards].sort(([left], [right]) => left.localeCompare(right))) {
  stations.sort((left, right) => left.name.localeCompare(right.name, 'ja') || left.id.localeCompare(right.id))
  const content = `${JSON.stringify(stations)}\n`
  checksum.update(id).update('\u0000').update(content)
  gridCounts[id] = stations.length
  await writeFile(resolve(outputDir, `${id}.json`), content, 'utf8')
}

const manifest = {
  dataVersion: DATA_VERSION,
  sourceDataset: 'N05',
  schemaVersion: 1,
  gridSizeDegrees: 0.25,
  sourceFeatureCount: source.features.length,
  adoptedSourceRecordCount: currentRecords.length,
  excluded,
  stationGroupCount: stationGroups.length,
  generatedAt: new Date().toISOString(),
  sourceUrls: [
    SOURCE_URL,
    'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N05-2025.html'
  ],
  usageRestriction: 'non-commercial',
  grids: gridCounts,
  checksum: checksum.digest('hex')
}
await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const accounted = currentRecords.length + excluded.ended + excluded.suspended + excluded.invalid
if (accounted !== source.features.length) throw new Error(`Source accounting mismatch: ${accounted}`)
console.log(JSON.stringify({
  sourceFeatures: source.features.length,
  currentRecords: currentRecords.length,
  stationGroups: stationGroups.length,
  shardCount: shards.size,
  excluded
}, null, 2))
