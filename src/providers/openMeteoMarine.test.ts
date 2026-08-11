import { describe, expect, it } from 'vitest'

import {
  buildOpenMeteoMarineUrl,
  normalizeMarineResponse
} from './openMeteoMarine'

const origin = { latitude: 35, longitude: 139 }
const start = Date.parse('2026-08-11T00:00:00.000Z') / 1_000
const times = Array.from({ length: 37 }, (_, index) => start + index * 3_600)
const levels = times.map((_, index) => Number(Math.cos(index * Math.PI / 6).toFixed(4)))

const fixture = {
  latitude: 35.05,
  longitude: 139.05,
  timezone: 'Asia/Tokyo',
  hourly: { time: times, sea_level_height_msl: levels },
  hourly_units: { time: 'unixtime', sea_level_height_msl: 'm' }
}

describe('Open-Meteo Marine provider', () => {
  it('丸めた座標と海面高度だけを36時間分要求する', () => {
    const url = new URL(buildOpenMeteoMarineUrl({ latitude: 35.681236, longitude: 139.767125 }))
    expect(url.origin + url.pathname).toBe('https://marine-api.open-meteo.com/v1/marine')
    expect(url.searchParams.get('latitude')).toBe('35.68')
    expect(url.searchParams.get('longitude')).toBe('139.77')
    expect(url.searchParams.get('hourly')).toBe('sea_level_height_msl')
    expect(url.searchParams.get('past_hours')).toBe('6')
    expect(url.searchParams.get('forecast_hours')).toBe('36')
    expect(url.searchParams.get('timeformat')).toBe('unixtime')
  })

  it('将来の極小・極大を交互に最大4件抽出する', () => {
    const result = normalizeMarineResponse(
      fixture,
      origin,
      new Date('2026-08-11T01:00:00.000Z'),
      '2026-08-11T01:00:05.000Z'
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') throw new Error('expected available')
    expect(result.summary.events).toEqual([
      { kind: 'low', occurredAt: '2026-08-11T06:00:00.000Z', seaLevelHeightMsl: -1 },
      { kind: 'high', occurredAt: '2026-08-11T12:00:00.000Z', seaLevelHeightMsl: 1 },
      { kind: 'low', occurredAt: '2026-08-11T18:00:00.000Z', seaLevelHeightMsl: -1 },
      { kind: 'high', occurredAt: '2026-08-12T00:00:00.000Z', seaLevelHeightMsl: 1 }
    ])
    expect(result.summary.disclaimerCode).toBe('approximate-not-for-navigation')
    expect(result.summary.distanceMeters).toBeGreaterThan(0)
  })

  it('海洋格子が30km超なら内陸の対象外にする', () => {
    const result = normalizeMarineResponse(
      { ...fixture, latitude: 35.3, longitude: 139.3 },
      origin,
      new Date('2026-08-11T01:00:00.000Z'),
      '2026-08-11T01:00:05.000Z'
    )
    expect(result).toMatchObject({ status: 'not_applicable' })
  })

  it('一定値・配列不一致・候補1件は安全な不足エラーにする', () => {
    expect(() => normalizeMarineResponse(
      { ...fixture, hourly: { time: times, sea_level_height_msl: times.map(() => 0) } },
      origin,
      new Date('2026-08-11T01:00:00.000Z'),
      '2026-08-11T01:00:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'TIDE_INSUFFICIENT' }))

    expect(() => normalizeMarineResponse(
      { ...fixture, hourly: { time: times, sea_level_height_msl: [0] } },
      origin,
      new Date('2026-08-11T01:00:00.000Z'),
      '2026-08-11T01:00:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'TIDE_SCHEMA_ERROR' }))

    expect(() => normalizeMarineResponse(
      {
        ...fixture,
        hourly: {
          time: times.slice(0, 10),
          sea_level_height_msl: levels.slice(0, 10)
        }
      },
      origin,
      new Date('2026-08-11T01:00:00.000Z'),
      '2026-08-11T01:00:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'TIDE_INSUFFICIENT' }))
  })
})
