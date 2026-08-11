import { describe, expect, it } from 'vitest'

import {
  formatJstDateTime,
  formatJstLocalDate,
  millisecondsUntilNextMinute,
  unixSecondsToUtcIso
} from './time'

describe('formatJstDateTime', () => {
  it('同じ瞬間をJSTの日付・曜日・24時間時計へ変換する', () => {
    const result = formatJstDateTime(new Date('2026-08-11T05:32:00.000Z'))

    expect(result).toEqual({
      dateLabel: '2026年8月11日（火）',
      timeLabel: '14:32'
    })
  })

  it('UTC日付とJST日付が異なる瞬間をJSTローカル日へ変換する', () => {
    expect(formatJstLocalDate(new Date('2026-08-10T15:00:00.000Z'))).toBe('2026-08-11')
    expect(formatJstLocalDate(new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01-01')
  })

  it('Unix秒をUTC ISO日時へ変換する', () => {
    expect(unixSecondsToUtcIso(0)).toBe('1970-01-01T00:00:00.000Z')
    expect(unixSecondsToUtcIso(60)).toBe('1970-01-01T00:01:00.000Z')
  })

  it('次の分境界までの待ち時間をミリ秒で返す', () => {
    expect(millisecondsUntilNextMinute(new Date('2026-08-11T05:32:00.000Z'))).toBe(60_000)
    expect(millisecondsUntilNextMinute(new Date('2026-08-11T05:32:59.999Z'))).toBe(1)
  })

  it('不正な日時とUnix秒を拒否する', () => {
    expect(() => formatJstLocalDate(new Date(Number.NaN))).toThrow()
    expect(() => unixSecondsToUtcIso(Number.NaN)).toThrow()
  })
})
