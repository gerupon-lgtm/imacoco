import { z } from 'zod'

import type { Coordinates } from '../domain/geo'
import { searchNearestStations, type StationGroupRecord } from '../domain/nearby'

const manifestSchema = z.object({
  dataVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceDataset: z.literal('N05'),
  schemaVersion: z.literal(1),
  gridSizeDegrees: z.literal(0.25),
  usageRestriction: z.literal('non-commercial'),
  grids: z.record(z.string(), z.number().int().positive())
})

const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
})

const stationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  coordinates: coordinatesSchema,
  lines: z.array(z.object({
    lineName: z.string().min(1),
    operatorName: z.string().min(1),
    operatorType: z.string().min(1)
  })),
  sourceRelationIds: z.array(z.string().min(1)).min(1),
  installedStartYear: z.number().int(),
  installedEndYear: z.literal(9999),
  sourceNote: z.string().optional(),
  dataVersion: z.string()
})

const shardSchema = z.array(stationSchema)

export type StationProviderErrorCode =
  | 'STATION_MANIFEST_ERROR'
  | 'STATION_SHARD_ERROR'
  | 'STATION_SCHEMA_ERROR'

export class StationProviderError extends Error {
  constructor(public readonly code: StationProviderErrorCode) {
    super(code === 'STATION_MANIFEST_ERROR'
      ? '駅データの一覧を読み込めませんでした'
      : code === 'STATION_SHARD_ERROR'
        ? '周辺の駅データを読み込めませんでした'
        : '駅データを読み取れませんでした')
    this.name = 'StationProviderError'
  }
}

export function gridIdsForRadius(origin: Coordinates, radiusMeters: number) {
  const latitudeDelta = radiusMeters / 111_195
  const longitudeScale = Math.max(Math.cos(origin.latitude * Math.PI / 180), 0.05)
  const longitudeDelta = radiusMeters / (111_195 * longitudeScale)
  const minimumLatitudeIndex = Math.floor((origin.latitude - latitudeDelta) * 4)
  const maximumLatitudeIndex = Math.floor((origin.latitude + latitudeDelta) * 4)
  const minimumLongitudeIndex = Math.floor((origin.longitude - longitudeDelta) * 4)
  const maximumLongitudeIndex = Math.floor((origin.longitude + longitudeDelta) * 4)
  const result: string[] = []
  for (let latitudeIndex = minimumLatitudeIndex; latitudeIndex <= maximumLatitudeIndex; latitudeIndex += 1) {
    for (let longitudeIndex = minimumLongitudeIndex; longitudeIndex <= maximumLongitudeIndex; longitudeIndex += 1) {
      result.push(`${latitudeIndex}-${longitudeIndex}`)
    }
  }
  return result
}

type StaticStationProviderOptions = {
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export function createStaticStationProvider({
  fetchImpl = fetch,
  baseUrl = '/data/stations'
}: StaticStationProviderOptions = {}) {
  let manifestPromise: Promise<z.infer<typeof manifestSchema>> | undefined

  const loadManifest = () => {
    if (manifestPromise) return manifestPromise
    manifestPromise = (async () => {
      try {
        const response = await fetchImpl(`${baseUrl}/manifest.json`)
        if (!response.ok) throw new StationProviderError('STATION_MANIFEST_ERROR')
        const parsed = manifestSchema.safeParse(await response.json())
        if (!parsed.success) throw new StationProviderError('STATION_MANIFEST_ERROR')
        return parsed.data
      } catch (error) {
        manifestPromise = undefined
        if (error instanceof StationProviderError) throw error
        throw new StationProviderError('STATION_MANIFEST_ERROR')
      }
    })()
    return manifestPromise
  }

  const fetchStations = async (origin: Coordinates) => {
    const manifest = await loadManifest()
    const gridIds = gridIdsForRadius(origin, 30_000).filter((id) => id in manifest.grids)

    let shards: StationGroupRecord[][]
    try {
      shards = await Promise.all(gridIds.map(async (id) => {
        const response = await fetchImpl(`${baseUrl}/${id}.json`)
        if (!response.ok) throw new StationProviderError('STATION_SHARD_ERROR')
        let body: unknown
        try {
          body = await response.json()
        } catch {
          throw new StationProviderError('STATION_SCHEMA_ERROR')
        }
        const parsed = shardSchema.safeParse(body)
        if (!parsed.success) throw new StationProviderError('STATION_SCHEMA_ERROR')
        return parsed.data
      }))
    } catch (error) {
      if (error instanceof StationProviderError) {
        throw error.code === 'STATION_SCHEMA_ERROR'
          ? error
          : new StationProviderError('STATION_SHARD_ERROR')
      }
      throw new StationProviderError('STATION_SHARD_ERROR')
    }

    return searchNearestStations(shards.flat(), origin, manifest.dataVersion)
  }

  return { fetchStations }
}

export type StaticStationProvider = ReturnType<typeof createStaticStationProvider>
