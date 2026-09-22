import { describe, expect, it } from 'vitest'

import { getJapaneseHolidayName, japaneseHolidayDataInfo } from './japaneseHolidays'

describe('日本の祝日', () => {
  it('JSTの日付から祝日名を返す', () => {
    expect(getJapaneseHolidayName(new Date('2026-09-22T15:00:00.000Z'))).toBe('秋分の日')
    expect(getJapaneseHolidayName(new Date('2026-05-05T15:00:00.000Z'))).toBe('休日')
  })

  it('祝日ではない日は名称を返さない', () => {
    expect(getJapaneseHolidayName(new Date('2026-08-12T03:00:00.000Z'))).toBeUndefined()
  })

  it('公式データの出典と収録終了日を保持する', () => {
    expect(japaneseHolidayDataInfo.sourceUrl).toBe('https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv')
    expect(japaneseHolidayDataInfo.coveredThrough).toBe('2027-11-23')
  })
})
