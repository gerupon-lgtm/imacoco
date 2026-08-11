import { describe, expect, it } from 'vitest'

import {
  assessCacheEntry,
  createLocationSnapshot,
  createResourceCacheEntry,
  type ResourceCacheEntry
} from './cachePolicy'

const origin = { latitude: 35.6812, longitude: 139.7671 }
const fetchedAt = new Date('2026-08-11T05:30:00.000Z')

function approximatelyNorth(meters: number) {
  return { latitude: origin.latitude + meters / 111_195, longitude: origin.longitude }
}

function entry(resourceType: ResourceCacheEntry['resourceType']) {
  return createResourceCacheEntry({
    resourceType,
    origin,
    payload: { ok: true },
    provider: 'fixture',
    fetchedAt
  })
}

describe('cache policy', () => {
  it('位置は小数4桁・最新1件・24時間期限のスナップショットへ変換する', () => {
    expect(createLocationSnapshot({
      latitude: 35.681236,
      longitude: 139.767125,
      accuracyMeters: 18,
      capturedAt: '2026-08-11T05:31:00.000Z'
    })).toEqual({
      schemaVersion: 1,
      coordinates: { latitude: 35.6812, longitude: 139.7671 },
      accuracyMeters: 18,
      acquiredAt: '2026-08-11T05:31:00.000Z',
      expiresAt: '2026-08-12T05:31:00.000Z'
    })
  })

  it.each([
    ['place', 249],
    ['government', 249],
    ['station', 249],
    ['medical', 249],
    ['weather', 999],
    ['solar', 999],
    ['tide', 999]
  ] as const)('%sは距離内かつ14分59秒でfreshになる', (resourceType, meters) => {
    expect(assessCacheEntry(
      entry(resourceType),
      approximatelyNorth(meters),
      new Date('2026-08-11T05:44:59.000Z')
    )).toBe('fresh')
  })

  it('250m・1km・15分の境界はfresh扱いにしない', () => {
    expect(assessCacheEntry(entry('place'), approximatelyNorth(250.2), new Date('2026-08-11T05:40:00.000Z'))).toBe('miss')
    expect(assessCacheEntry(entry('weather'), approximatelyNorth(1_000.2), new Date('2026-08-11T05:40:00.000Z'))).toBe('miss')
    expect(assessCacheEntry(entry('weather'), origin, new Date('2026-08-11T05:45:00.000Z'))).toBe('stale')
  })

  it('24時間直前はstale、24時間以後はexpiredになる', () => {
    expect(assessCacheEntry(entry('weather'), origin, new Date('2026-08-12T05:29:59.999Z'))).toBe('stale')
    expect(assessCacheEntry(entry('weather'), origin, new Date('2026-08-12T05:30:00.000Z'))).toBe('expired')
  })
})
