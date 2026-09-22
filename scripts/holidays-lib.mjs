export const HOLIDAY_SOURCE_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'

const EXPECTED_HEADER = '国民の祝日・休日月日,国民の祝日・休日名称'

function toIsoDate(value) {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value)
  if (!match) throw new Error(`祝日の日付形式が不正です: ${value}`)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const instant = new Date(Date.UTC(year, month - 1, day))
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new Error(`祝日の日付が不正です: ${value}`)
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function parseHolidayCsv(csvText) {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.shift() !== EXPECTED_HEADER) {
    throw new Error('内閣府の祝日CSVヘッダーが想定と異なります')
  }

  const holidays = new Map()
  for (const line of lines) {
    const separatorIndex = line.indexOf(',')
    if (separatorIndex < 1) throw new Error(`祝日CSVの行形式が不正です: ${line}`)

    const date = toIsoDate(line.slice(0, separatorIndex).trim())
    const name = line.slice(separatorIndex + 1).trim()
    if (!name) throw new Error(`祝日名がありません: ${date}`)
    if (holidays.has(date)) throw new Error(`祝日の日付が重複しています: ${date}`)
    holidays.set(date, name)
  }

  if (holidays.size < 1_000) {
    throw new Error(`祝日CSVの件数が少なすぎます: ${holidays.size}`)
  }

  return [...holidays.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, name]) => ({ date, name }))
}

export function buildHolidayDataset(csvText) {
  const records = parseHolidayCsv(csvText)
  return {
    schemaVersion: 1,
    sourceName: '内閣府「国民の祝日について」',
    sourceUrl: HOLIDAY_SOURCE_URL,
    coveredThrough: records.at(-1)?.date,
    recordCount: records.length,
    holidays: Object.fromEntries(records.map(({ date, name }) => [date, name]))
  }
}

export function validateHolidayDatasetUpdate(current, next) {
  if (!current || typeof current !== 'object' || !next || typeof next !== 'object') {
    throw new Error('祝日データの比較対象が不正です')
  }
  if (next.recordCount < current.recordCount) {
    throw new Error(`祝日データの件数が減少しています: ${current.recordCount} -> ${next.recordCount}`)
  }
  if (next.coveredThrough < current.coveredThrough) {
    throw new Error(`祝日データの収録期限が後退しています: ${current.coveredThrough} -> ${next.coveredThrough}`)
  }

  for (const date of Object.keys(current.holidays ?? {})) {
    if (!(date in (next.holidays ?? {}))) {
      throw new Error(`既存の祝日が新しいデータから欠落しています: ${date}`)
    }
  }
}
