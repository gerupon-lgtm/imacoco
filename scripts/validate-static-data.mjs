import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function validateCoordinates(value, label) {
  assert(Number.isFinite(value?.latitude) && value.latitude >= -90 && value.latitude <= 90, `${label}: 緯度が不正です`)
  assert(Number.isFinite(value?.longitude) && value.longitude >= -180 && value.longitude <= 180, `${label}: 経度が不正です`)
}

async function validateShardedData({ directory, manifest, expectedCount, validateRecord }) {
  const gridEntries = Object.entries(manifest.grids)
  const files = (await readdir(resolve(root, directory))).filter((name) => name.endsWith('.json') && name !== 'manifest.json')
  assert(files.length === gridEntries.length, `${directory}: shard数 ${files.length} がmanifest ${gridEntries.length} と一致しません`)

  const ids = new Set()
  let recordCount = 0
  for (const [grid, manifestCount] of gridEntries) {
    const records = await readJson(`${directory}/${grid}.json`)
    assert(Array.isArray(records), `${directory}/${grid}.json: 配列ではありません`)
    assert(records.length === manifestCount, `${directory}/${grid}.json: 件数 ${records.length} がmanifest ${manifestCount} と一致しません`)
    for (const record of records) {
      assert(typeof record.id === 'string' && record.id.length > 0, `${directory}/${grid}.json: IDが不正です`)
      assert(!ids.has(record.id), `${directory}: ID ${record.id} が重複しています`)
      ids.add(record.id)
      validateCoordinates(record.coordinates, `${directory}: ${record.id}`)
      validateRecord(record, manifest)
    }
    recordCount += records.length
  }

  assert(recordCount === expectedCount, `${directory}: 総件数 ${recordCount} がmanifest ${expectedCount} と一致しません`)
  return { shardCount: files.length, recordCount }
}

const municipalityMaster = await readJson('src/data/municipalities.generated.json')
assert(municipalityMaster.recordCount === Object.keys(municipalityMaster.records).length, '自治体マスターの件数が一致しません')

const stationManifest = await readJson('public/data/stations/manifest.json')
assert(stationManifest.sourceFeatureCount === stationManifest.adoptedSourceRecordCount + Object.values(stationManifest.excluded).reduce((sum, value) => sum + value, 0), '駅データの採用・除外件数が原典件数と一致しません')
assert(stationManifest.usageRestriction === 'non-commercial', '駅データの非商用条件が記録されていません')
const stationResult = await validateShardedData({
  directory: 'public/data/stations',
  manifest: stationManifest,
  expectedCount: stationManifest.stationGroupCount,
  validateRecord(record, manifest) {
    assert(record.dataVersion === manifest.dataVersion, `駅 ${record.id}: データ版が一致しません`)
    assert(Array.isArray(record.lines) && record.lines.length > 0, `駅 ${record.id}: 路線がありません`)
  }
})

const medicalManifest = await readJson('public/data/medical/manifest.json')
const medicalTypeCount = Object.values(medicalManifest.facilityCounts).reduce((sum, value) => sum + value, 0)
assert(medicalManifest.accounting.sourceRecords === medicalManifest.accounting.generatedRecords + medicalManifest.accounting.invalidIdentity + medicalManifest.accounting.invalidCoordinates + medicalManifest.accounting.invalidMunicipality, '医療データの採用・除外件数が原典件数と一致しません')
assert(medicalTypeCount === medicalManifest.accounting.generatedRecords, '医療データの種別件数が生成件数と一致しません')
const medicalTypes = new Set(['hospital', 'clinic', 'dental', 'pharmacy', 'midwifery'])
const medicalResult = await validateShardedData({
  directory: 'public/data/medical',
  manifest: medicalManifest,
  expectedCount: medicalManifest.accounting.generatedRecords,
  validateRecord(record, manifest) {
    assert(record.sourceUpdatedAt === manifest.dataVersion, `医療機関 ${record.id}: データ版が一致しません`)
    assert(medicalTypes.has(record.type), `医療機関 ${record.id}: 種別が不正です`)
  }
})

const governmentManifest = await readJson('public/data/government/manifest.json')
const offices = await readJson('public/data/government/offices.json')
assert(Array.isArray(offices) && offices.length === governmentManifest.recordCount, '役所データの件数がmanifestと一致しません')
const officeIds = new Set()
const localOfficeCodes = new Set()
let prefecturalOfficeCount = 0
const prefecturalOffices = []
for (const office of offices) {
  assert(typeof office.id === 'string' && !officeIds.has(office.id), `役所ID ${office.id} が不正または重複しています`)
  officeIds.add(office.id)
  validateCoordinates(office.coordinates, `役所 ${office.id}`)
  assert(/^https:\/\//.test(office.officialUrl), `役所 ${office.id}: 公式確認先がHTTPSではありません`)
  if (office.officeType === 'prefectural') {
    prefecturalOfficeCount += 1
    prefecturalOffices.push(office)
  }
  else localOfficeCodes.add(office.municipalityCode)
}
assert(prefecturalOfficeCount === 47, `都道府県庁が47件ではありません: ${prefecturalOfficeCount}`)
assert(
  prefecturalOffices.every((office) => !office.officialUrl.includes('j-lis.go.jp')),
  `都道府県庁の公式リンクがJ-LISへフォールバックしています: ${prefecturalOffices.filter((office) => office.officialUrl.includes('j-lis.go.jp')).map((office) => office.name).join(', ')}`
)
assert(
  prefecturalOffices.find((office) => office.municipalityCode === '24')?.officialUrl === 'https://www.pref.mie.lg.jp/',
  '三重県庁の公式リンクが三重県公式サイトではありません'
)
assert(localOfficeCodes.size === governmentManifest.localOfficeCount, '役所データの自治体コード数がmanifestと一致しません')

const missingCodes = Object.keys(municipalityMaster.records).filter((code) => !localOfficeCodes.has(code)).sort()
assert(JSON.stringify(missingCodes) === JSON.stringify([...governmentManifest.missingCurrentCodes].sort()), '役所未収録の自治体コードがmanifestと一致しません')
assert(missingCodes.every((code) => ['1695', '1696', '1697', '1698', '1699', '1700'].includes(code)), `想定外の役所未収録コードがあります: ${missingCodes.join(', ')}`)

console.log(`static data ok: municipalities=${municipalityMaster.recordCount}, stations=${stationResult.recordCount}/${stationResult.shardCount} shards, government=${offices.length}, medical=${medicalResult.recordCount}/${medicalResult.shardCount} shards`)
