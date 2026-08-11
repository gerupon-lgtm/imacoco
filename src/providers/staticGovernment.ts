import { z } from 'zod'

import type { Coordinates } from '../domain/geo'
import {
  buildGovernmentSummary,
  GovernmentDataError,
  type OfficeRecord
} from '../domain/government'

const manifestSchema = z.object({
  dataVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  schemaVersion: z.literal(1),
  recordCount: z.number().int().positive()
})
const httpsUrlSchema = z.string().url().refine((value) => value.startsWith('https://'))
const officeSchema = z.object({
  id: z.string().min(1),
  municipalityCode: z.string().regex(/^\d{1,5}$/),
  officeType: z.enum(['prefectural', 'city', 'ward', 'town', 'village']),
  name: z.string().min(1),
  coordinates: z.object({
    latitude: z.number().finite().min(20).max(50),
    longitude: z.number().finite().min(120).max(155)
  }),
  officialUrl: httpsUrlSchema,
  sourceAddress: z.string().min(1),
  sourceUrl: httpsUrlSchema,
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})
const officesSchema = z.array(officeSchema)

export type StaticGovernmentErrorCode =
  | 'GOVERNMENT_MANIFEST_ERROR'
  | 'GOVERNMENT_DATA_INVALID'
  | 'GOVERNMENT_NOT_FOUND'

export class StaticGovernmentError extends Error {
  constructor(public readonly code: StaticGovernmentErrorCode) {
    super(code === 'GOVERNMENT_NOT_FOUND'
      ? '役所情報が見つかりませんでした'
      : code === 'GOVERNMENT_MANIFEST_ERROR'
        ? '役所データの一覧を読み込めませんでした'
        : '役所データを読み取れませんでした')
    this.name = 'StaticGovernmentError'
  }
}

type Options = { fetchImpl?: typeof fetch; baseUrl?: string }

export function createStaticGovernmentProvider({
  fetchImpl = fetch,
  baseUrl = '/data/government'
}: Options = {}) {
  let dataPromise: Promise<{ dataVersion: string; offices: OfficeRecord[] }> | undefined

  const load = () => {
    if (dataPromise) return dataPromise
    dataPromise = (async () => {
      try {
        const [manifestResponse, officesResponse] = await Promise.all([
          fetchImpl(`${baseUrl}/manifest.json`),
          fetchImpl(`${baseUrl}/offices.json`)
        ])
        if (!manifestResponse.ok) throw new StaticGovernmentError('GOVERNMENT_MANIFEST_ERROR')
        if (!officesResponse.ok) throw new StaticGovernmentError('GOVERNMENT_DATA_INVALID')
        const manifest = manifestSchema.safeParse(await manifestResponse.json())
        if (!manifest.success) throw new StaticGovernmentError('GOVERNMENT_MANIFEST_ERROR')
        const offices = officesSchema.safeParse(await officesResponse.json())
        if (!offices.success || offices.data.length !== manifest.data.recordCount) {
          throw new StaticGovernmentError('GOVERNMENT_DATA_INVALID')
        }
        return { dataVersion: manifest.data.dataVersion, offices: offices.data }
      } catch (error) {
        dataPromise = undefined
        if (error instanceof StaticGovernmentError) throw error
        throw new StaticGovernmentError('GOVERNMENT_DATA_INVALID')
      }
    })()
    return dataPromise
  }

  const fetchGovernment = async (origin: Coordinates, municipalityCode: string) => {
    const data = await load()
    try {
      return buildGovernmentSummary(data.offices, origin, municipalityCode, data.dataVersion)
    } catch (error) {
      if (error instanceof GovernmentDataError && error.code === 'GOVERNMENT_NOT_FOUND') {
        throw new StaticGovernmentError('GOVERNMENT_NOT_FOUND')
      }
      throw new StaticGovernmentError('GOVERNMENT_DATA_INVALID')
    }
  }

  return { fetchGovernment }
}

export type StaticGovernmentProvider = ReturnType<typeof createStaticGovernmentProvider>
