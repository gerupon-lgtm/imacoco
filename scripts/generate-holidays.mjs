import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  buildHolidayDataset,
  HOLIDAY_SOURCE_URL,
  validateHolidayDatasetUpdate
} from './holidays-lib.mjs'

const outputPath = resolve(import.meta.dirname, '../src/data/japaneseHolidays.generated.json')
const checkOnly = process.argv.includes('--check')

async function fetchHolidayCsv() {
  let lastError
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(HOLIDAY_SOURCE_URL, {
        headers: { 'User-Agent': 'imakoko-info-holiday-updater/1.0' },
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (!response.headers.get('content-type')?.includes('text/csv')) {
        throw new Error(`Content-Typeが不正です: ${response.headers.get('content-type') ?? 'なし'}`)
      }
      return new TextDecoder('shift_jis', { fatal: true }).decode(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000))
    }
  }
  throw new Error(`内閣府の祝日CSVを取得できませんでした: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

const dataset = buildHolidayDataset(await fetchHolidayCsv())
const generated = `${JSON.stringify(dataset, null, 2)}\n`
const currentText = await readFile(outputPath, 'utf8').catch(() => '')
if (currentText) {
  validateHolidayDatasetUpdate(JSON.parse(currentText), dataset)
}

if (checkOnly) {
  if (currentText !== generated) {
    throw new Error('祝日データが内閣府の最新CSVと一致しません。npm run data:holidays を実行してください')
  }
  process.stdout.write(`holiday data is current: ${dataset.recordCount} records through ${dataset.coveredThrough}\n`)
} else {
  await writeFile(outputPath, generated, 'utf8')
  process.stdout.write(`holiday data generated: ${dataset.recordCount} records through ${dataset.coveredThrough}\n`)
}
