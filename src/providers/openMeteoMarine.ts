import { z } from 'zod'

import type { Coordinates } from '../domain/geo'
import { haversineDistanceMeters } from '../domain/geo'
import { unixSecondsToUtcIso } from '../domain/time'

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine'
const MAX_MODEL_DISTANCE_METERS = 30_000

const finiteNumber = z.number().finite()
const marineResponseSchema = z.object({
  latitude: finiteNumber.min(-90).max(90),
  longitude: finiteNumber.min(-180).max(180),
  timezone: z.literal('Asia/Tokyo'),
  hourly: z.object({
    time: z.array(finiteNumber),
    sea_level_height_msl: z.array(finiteNumber.nullable())
  }),
  hourly_units: z.object({
    time: z.literal('unixtime'),
    sea_level_height_msl: z.literal('m')
  })
})

export type TideEvent = {
  kind: 'high' | 'low'
  occurredAt: string
  seaLevelHeightMsl: number
}

export type TideSummary = {
  modelCoordinates: Coordinates
  distanceMeters: number
  events: TideEvent[]
  fetchedAt: string
  disclaimerCode: 'approximate-not-for-navigation'
}

export type MarineResult =
  | { status: 'available'; summary: TideSummary }
  | { status: 'not_applicable'; distanceMeters: number }

export type TideProviderErrorCode =
  | 'TIDE_NETWORK_ERROR'
  | 'TIDE_TIMEOUT'
  | 'TIDE_SCHEMA_ERROR'
  | 'TIDE_INSUFFICIENT'

const ERROR_MESSAGES: Record<TideProviderErrorCode, string> = {
  TIDE_NETWORK_ERROR: '潮の目安を取得できませんでした',
  TIDE_TIMEOUT: '潮の目安の取得に時間がかかっています',
  TIDE_SCHEMA_ERROR: '海面データを読み取れませんでした',
  TIDE_INSUFFICIENT: '潮の変化を十分に確認できませんでした'
}

export class TideProviderError extends Error {
  constructor(public readonly code: TideProviderErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'TideProviderError'
  }
}

export function buildOpenMeteoMarineUrl(coordinates: Coordinates) {
  const url = new URL(MARINE_URL)
  url.searchParams.set('latitude', coordinates.latitude.toFixed(2))
  url.searchParams.set('longitude', coordinates.longitude.toFixed(2))
  url.searchParams.set('hourly', 'sea_level_height_msl')
  url.searchParams.set('past_hours', '6')
  url.searchParams.set('forecast_hours', '36')
  url.searchParams.set('timezone', 'Asia/Tokyo')
  url.searchParams.set('timeformat', 'unixtime')
  return url.toString()
}

function extractExtrema(
  times: number[],
  levels: Array<number | null>,
  currentUnixSeconds: number
) {
  const candidates: TideEvent[] = []

  for (let index = 1; index < levels.length - 1; index += 1) {
    const previous = levels[index - 1]
    const current = levels[index]
    const next = levels[index + 1]
    if (previous === null || current === null || next === null || times[index] < currentUnixSeconds) continue

    const kind = current > previous && current > next
      ? 'high'
      : current < previous && current < next
        ? 'low'
        : undefined
    if (!kind) continue

    const event: TideEvent = {
      kind,
      occurredAt: unixSecondsToUtcIso(times[index]),
      seaLevelHeightMsl: current
    }

    const last = candidates.at(-1)
    if (last?.kind === kind) {
      const isMoreExtreme = kind === 'high'
        ? current > last.seaLevelHeightMsl
        : current < last.seaLevelHeightMsl
      if (isMoreExtreme) candidates[candidates.length - 1] = event
    } else {
      candidates.push(event)
    }
  }

  return candidates.slice(0, 4)
}

export function normalizeMarineResponse(
  response: unknown,
  origin: Coordinates,
  currentInstant: Date,
  fetchedAt: string
): MarineResult {
  const parsed = marineResponseSchema.safeParse(response)
  if (!parsed.success) throw new TideProviderError('TIDE_SCHEMA_ERROR')

  const data = parsed.data
  if (data.hourly.time.length < 3 || data.hourly.time.length !== data.hourly.sea_level_height_msl.length) {
    throw new TideProviderError('TIDE_SCHEMA_ERROR')
  }

  const modelCoordinates = { latitude: data.latitude, longitude: data.longitude }
  const distanceMeters = haversineDistanceMeters(origin, modelCoordinates)
  if (distanceMeters > MAX_MODEL_DISTANCE_METERS) {
    return { status: 'not_applicable', distanceMeters }
  }

  const events = extractExtrema(
    data.hourly.time,
    data.hourly.sea_level_height_msl,
    currentInstant.getTime() / 1_000
  )
  if (events.length < 2) throw new TideProviderError('TIDE_INSUFFICIENT')

  return {
    status: 'available',
    summary: {
      modelCoordinates,
      distanceMeters,
      events,
      fetchedAt,
      disclaimerCode: 'approximate-not-for-navigation'
    }
  }
}

type MarineProviderOptions = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

export function createOpenMeteoMarineProvider({
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000
}: MarineProviderOptions = {}) {
  const fetchTide = async (coordinates: Coordinates) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(buildOpenMeteoMarineUrl(coordinates), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) throw new TideProviderError('TIDE_NETWORK_ERROR')

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new TideProviderError('TIDE_SCHEMA_ERROR')
      }

      const fetchedAt = now()
      return normalizeMarineResponse(body, coordinates, fetchedAt, fetchedAt.toISOString())
    } catch (error) {
      if (error instanceof TideProviderError) throw error
      if (controller.signal.aborted) throw new TideProviderError('TIDE_TIMEOUT')
      throw new TideProviderError('TIDE_NETWORK_ERROR')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return { fetchTide }
}

export type OpenMeteoMarineProvider = ReturnType<typeof createOpenMeteoMarineProvider>
