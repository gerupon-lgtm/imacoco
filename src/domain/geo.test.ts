import { describe, expect, it } from 'vitest'

import {
  direction8FromBearing,
  formatApproximateDistance,
  haversineDistanceMeters,
  initialBearingDegrees,
  roundCoordinates
} from './geo'

const tokyoStation = { latitude: 35.681236, longitude: 139.767125 }
const tokyoMetropolitanGovernment = { latitude: 35.689634, longitude: 139.692101 }

describe('位置計算', () => {
  it('東京駅から東京都庁までの直線距離と方角を求める', () => {
    const distance = haversineDistanceMeters(tokyoStation, tokyoMetropolitanGovernment)
    const bearing = initialBearingDegrees(tokyoStation, tokyoMetropolitanGovernment)

    expect(distance).toBeGreaterThan(6_500)
    expect(distance).toBeLessThan(7_100)
    expect(bearing).toBeDefined()
    expect(direction8FromBearing(bearing!)).toEqual({ label: '西', arrow: '←' })
  })

  it('同一点の距離は0で方位を持たない', () => {
    expect(haversineDistanceMeters(tokyoStation, tokyoStation)).toBe(0)
    expect(initialBearingDegrees(tokyoStation, tokyoStation)).toBeUndefined()
  })

  it('8方位の境界を北から北東へ切り替える', () => {
    expect(direction8FromBearing(22.499)).toEqual({ label: '北', arrow: '↑' })
    expect(direction8FromBearing(22.5)).toEqual({ label: '北東', arrow: '↗' })
    expect(direction8FromBearing(-45)).toEqual({ label: '北西', arrow: '↖' })
  })

  it('1km未満はm、1km以上はkmで概算表示する', () => {
    expect(formatApproximateDistance(200)).toBe('約200m')
    expect(formatApproximateDistance(999)).toBe('約1,000m')
    expect(formatApproximateDistance(1_000)).toBe('約1.0km')
    expect(formatApproximateDistance(6_720)).toBe('約6.7km')
    expect(formatApproximateDistance(12_200)).toBe('約12km')
  })

  it('送信用途に応じた桁数へ座標を丸める', () => {
    expect(roundCoordinates(tokyoStation, 4)).toEqual({ latitude: 35.6812, longitude: 139.7671 })
    expect(roundCoordinates(tokyoStation, 2)).toEqual({ latitude: 35.68, longitude: 139.77 })
  })

  it('範囲外の座標と距離を拒否する', () => {
    expect(() => haversineDistanceMeters({ latitude: 91, longitude: 0 }, tokyoStation)).toThrow()
    expect(() => formatApproximateDistance(-1)).toThrow()
  })
})
