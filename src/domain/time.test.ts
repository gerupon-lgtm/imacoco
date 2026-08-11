import { describe, expect, it } from 'vitest'

import { formatJstDateTime } from './time'

describe('formatJstDateTime', () => {
  it('同じ瞬間をJSTの日付・曜日・24時間時計へ変換する', () => {
    const result = formatJstDateTime(new Date('2026-08-11T05:32:00.000Z'))

    expect(result).toEqual({
      dateLabel: '2026年8月11日（火）',
      timeLabel: '14:32'
    })
  })
})
