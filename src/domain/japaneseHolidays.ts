import holidayDataset from '../data/japaneseHolidays.generated.json'
import { formatJstLocalDate } from './time'

const holidays = holidayDataset.holidays as Record<string, string>

export function getJapaneseHolidayName(instant: Date) {
  return holidays[formatJstLocalDate(instant)]
}

export const japaneseHolidayDataInfo = {
  sourceName: holidayDataset.sourceName,
  sourceUrl: holidayDataset.sourceUrl,
  coveredThrough: holidayDataset.coveredThrough
}
