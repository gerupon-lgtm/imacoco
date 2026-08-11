import type { Coordinates } from '../domain/geo'
import { haversineDistanceMeters, roundCoordinates } from '../domain/geo'
import type { LocationFix } from '../providers/geolocation'

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1_000

export type LocationSnapshot = {
  schemaVersion: 1
  coordinates: Coordinates
  accuracyMeters: number
  acquiredAt: string
  expiresAt: string
}

export type ResourceType =
  | 'place'
  | 'weather'
  | 'solar'
  | 'tide'
  | 'government'
  | 'station'
  | 'medical'

export type ResourceCacheEntry<T = unknown> = {
  resourceType: ResourceType
  origin: Coordinates
  payload: T
  fetchedAt: string
  freshUntil: string
  staleUntil: string
  provider: string
  dataVersion?: string
}

export type CacheAssessment = 'fresh' | 'stale' | 'expired' | 'miss'

function validDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError('保存日時が不正です')
  return date
}

export function createLocationSnapshot(fix: LocationFix): LocationSnapshot {
  const acquiredAt = validDate(fix.capturedAt)
  return {
    schemaVersion: 1,
    coordinates: roundCoordinates(fix, 4),
    accuracyMeters: fix.accuracyMeters,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: new Date(acquiredAt.getTime() + TWENTY_FOUR_HOURS_MS).toISOString()
  }
}

export function createResourceCacheEntry<T>({
  resourceType,
  origin,
  payload,
  provider,
  fetchedAt,
  dataVersion
}: {
  resourceType: ResourceType
  origin: Coordinates
  payload: T
  provider: string
  fetchedAt: Date
  dataVersion?: string
}): ResourceCacheEntry<T> {
  if (Number.isNaN(fetchedAt.getTime())) throw new RangeError('取得日時が不正です')
  return {
    resourceType,
    origin: roundCoordinates(origin, 4),
    payload,
    fetchedAt: fetchedAt.toISOString(),
    freshUntil: new Date(fetchedAt.getTime() + FIFTEEN_MINUTES_MS).toISOString(),
    staleUntil: new Date(fetchedAt.getTime() + TWENTY_FOUR_HOURS_MS).toISOString(),
    provider,
    ...(dataVersion ? { dataVersion } : {})
  }
}

function reuseDistanceMeters(resourceType: ResourceType) {
  return ['place', 'government', 'station', 'medical'].includes(resourceType) ? 250 : 1_000
}

export function assessCacheEntry(
  entry: ResourceCacheEntry,
  currentOrigin: Coordinates,
  now: Date
): CacheAssessment {
  if (Number.isNaN(now.getTime())) return 'expired'

  let freshUntil: Date
  let staleUntil: Date
  try {
    freshUntil = validDate(entry.freshUntil)
    staleUntil = validDate(entry.staleUntil)
  } catch {
    return 'expired'
  }

  if (now.getTime() >= staleUntil.getTime()) return 'expired'

  try {
    if (haversineDistanceMeters(entry.origin, currentOrigin) >= reuseDistanceMeters(entry.resourceType)) {
      return 'miss'
    }
  } catch {
    return 'expired'
  }

  return now.getTime() < freshUntil.getTime() ? 'fresh' : 'stale'
}
