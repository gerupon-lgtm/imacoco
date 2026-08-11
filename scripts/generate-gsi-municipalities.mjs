import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://maps.gsi.go.jp/js/muni.js'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(root, 'src/data/municipalities.generated.json')

const response = await fetch(SOURCE_URL)
if (!response.ok) throw new Error(`GSI municipality source returned HTTP ${response.status}`)

const source = await response.text()
const matches = [...source.matchAll(/MUNI_ARRAY\["(\d+)"\] = '([^']+)'/g)]
if (matches.length < 1_800) throw new Error(`Unexpected municipality record count: ${matches.length}`)

const records = {}
for (const [, sourceCode, value] of matches) {
  const [, prefectureName, municipalityCode, sourceName] = value.split(',')
  const code = (municipalityCode || sourceCode).replace(/^0+/, '')
  const designatedCityWard = sourceName.match(/^(.+市)[　\s]+(.+区)$/)

  records[code] = {
    code,
    prefectureName,
    municipalityName: designatedCityWard?.[1] ?? sourceName,
    ...(designatedCityWard ? { wardName: designatedCityWard[2] } : {})
  }
}

const sortedRecords = Object.fromEntries(
  Object.entries(records).sort(([left], [right]) => Number(left) - Number(right))
)

const output = {
  sourceUrl: SOURCE_URL,
  generatedAt: new Date().toISOString(),
  recordCount: Object.keys(sortedRecords).length,
  records: sortedRecords
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(`Generated ${output.recordCount} municipality records at ${outputPath}`)
