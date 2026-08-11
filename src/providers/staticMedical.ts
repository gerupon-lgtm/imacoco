import { z } from 'zod'

import type { Coordinates } from '../domain/geo'
import {
  searchMedicalFacilities,
  type MedicalFacilityRecord,
  type MedicalSummary
} from '../domain/nearby'
import { gridIdsForRadius } from './staticStations'

const manifestSchema = z.object({
  dataVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schemaVersion: z.literal(1),
  gridSizeDegrees: z.literal(0.25),
  grids: z.record(z.string(), z.number().int().positive())
})

const httpsUrlSchema = z.string().url().refine((value) => value.startsWith('https://'))
const medicalFacilitySchema = z.object({
  id: z.string().min(1),
  type: z.enum(['hospital', 'clinic', 'dental', 'pharmacy', 'midwifery']),
  name: z.string().min(1),
  coordinates: z.object({
    latitude: z.number().finite().min(20).max(50),
    longitude: z.number().finite().min(120).max(155)
  }),
  officialUrl: httpsUrlSchema.optional(),
  sourceDetailUrl: httpsUrlSchema.optional(),
  prefectureCode: z.string().regex(/^\d{2}$/),
  municipalityCode: z.string().regex(/^\d{5}$/),
  sourceUpdatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})
const shardSchema = z.array(medicalFacilitySchema)

export type MedicalProviderErrorCode =
  | 'MEDICAL_MANIFEST_ERROR'
  | 'MEDICAL_SHARD_MISSING'
  | 'MEDICAL_SCHEMA_ERROR'

export class MedicalProviderError extends Error {
  constructor(public readonly code: MedicalProviderErrorCode) {
    super(code === 'MEDICAL_MANIFEST_ERROR'
      ? '医療機関データの一覧を読み込めませんでした'
      : code === 'MEDICAL_SCHEMA_ERROR'
        ? '医療機関データを読み取れませんでした'
        : '周辺の医療機関データを読み込めませんでした')
    this.name = 'MedicalProviderError'
  }
}

type StaticMedicalProviderOptions = {
  fetchImpl?: typeof fetch
  baseUrl?: string
}

export function createStaticMedicalProvider({
  fetchImpl = fetch,
  baseUrl = '/data/medical'
}: StaticMedicalProviderOptions = {}) {
  let manifestPromise: Promise<z.infer<typeof manifestSchema>> | undefined

  const loadManifest = () => {
    if (manifestPromise) return manifestPromise
    manifestPromise = (async () => {
      try {
        const response = await fetchImpl(`${baseUrl}/manifest.json`)
        if (!response.ok) throw new MedicalProviderError('MEDICAL_MANIFEST_ERROR')
        const parsed = manifestSchema.safeParse(await response.json())
        if (!parsed.success) throw new MedicalProviderError('MEDICAL_MANIFEST_ERROR')
        return parsed.data
      } catch (error) {
        manifestPromise = undefined
        if (error instanceof MedicalProviderError) throw error
        throw new MedicalProviderError('MEDICAL_MANIFEST_ERROR')
      }
    })()
    return manifestPromise
  }

  const fetchMedical = async (origin: Coordinates): Promise<MedicalSummary> => {
    const manifest = await loadManifest()
    const loadShards = (gridIds: string[]) => Promise.all(gridIds.map(async (id) => {
      try {
        const response = await fetchImpl(`${baseUrl}/${id}.json`)
        if (!response.ok) return { ok: false as const }
        const parsed = shardSchema.safeParse(await response.json())
        if (!parsed.success) return { ok: false as const }
        return { ok: true as const, records: parsed.data }
      } catch {
        return { ok: false as const }
      }
    }))

    const tenKmGridIds = gridIdsForRadius(origin, 10_000).filter((id) => id in manifest.grids)
    let outcomes = await loadShards(tenKmGridIds)
    let successful = outcomes.filter((outcome) => outcome.ok)
    if (tenKmGridIds.length > 0 && successful.length === 0) {
      throw new MedicalProviderError('MEDICAL_SHARD_MISSING')
    }

    const uniqueRecords = () => [...new Map(successful
      .flatMap((outcome) => outcome.records)
      .map((record) => [record.id, record] as const)).values()] as MedicalFacilityRecord[]

    let records = uniqueRecords()
    let result = searchMedicalFacilities(records, origin, manifest.dataVersion)
    if (result.searchRadiusKm === 30) {
      const loadedIds = new Set(tenKmGridIds)
      const outerGridIds = gridIdsForRadius(origin, 30_000)
        .filter((id) => id in manifest.grids && !loadedIds.has(id))
      const outerOutcomes = await loadShards(outerGridIds)
      outcomes = [...outcomes, ...outerOutcomes]
      successful = outcomes.filter((outcome) => outcome.ok)
      if (outcomes.length > 0 && successful.length === 0) {
        throw new MedicalProviderError('MEDICAL_SHARD_MISSING')
      }
      records = uniqueRecords()
      result = searchMedicalFacilities(records, origin, manifest.dataVersion)
    }

    const missingShardCount = outcomes.length - successful.length
    return {
      ...result,
      partialData: missingShardCount > 0,
      missingShardCount,
      sourceNotice: missingShardCount > 0
        ? `${result.sourceNotice} 周辺データの一部を取得できませんでした。`
        : result.sourceNotice
    }
  }

  return { fetchMedical }
}

export type StaticMedicalProvider = ReturnType<typeof createStaticMedicalProvider>
