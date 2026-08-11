import { z } from 'zod'

import type { Coordinates } from '../domain/geo'

const GSI_REVERSE_GEOCODER_URL =
  'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'

const placeResponseSchema = z.object({
  results: z.object({
    muniCd: z.string().regex(/^\d{4,5}$/),
    lv01Nm: z.string().trim().min(1).optional()
  })
})

export type MunicipalityRecord = {
  code: string
  prefectureName: string
  municipalityName: string
  wardName?: string
}

export type MunicipalityMaster = Record<string, MunicipalityRecord>

export type PlaceSummary = {
  municipalityCode: string
  prefectureName: string
  municipalityName: string
  wardName?: string
  localityName?: string
  displayName: string
  boundaryCaution: boolean
  providerFetchedAt: string
}

export type PlaceProviderErrorCode =
  | 'PLACE_NETWORK_ERROR'
  | 'PLACE_TIMEOUT'
  | 'PLACE_SCHEMA_ERROR'
  | 'PLACE_MUNICIPALITY_UNKNOWN'

const ERROR_MESSAGES: Record<PlaceProviderErrorCode, string> = {
  PLACE_NETWORK_ERROR: '地名を取得できませんでした',
  PLACE_TIMEOUT: '地名の取得に時間がかかっています',
  PLACE_SCHEMA_ERROR: '地名データを読み取れませんでした',
  PLACE_MUNICIPALITY_UNKNOWN: '行政区域を確認できませんでした'
}

export class PlaceProviderError extends Error {
  constructor(
    public readonly code: PlaceProviderErrorCode,
    public readonly localityName?: string
  ) {
    super(ERROR_MESSAGES[code])
    this.name = 'PlaceProviderError'
  }
}

function normalizedMunicipalityCode(code: string) {
  return code.replace(/^0+/, '') || '0'
}

export function buildGsiReverseGeocoderUrl(coordinates: Coordinates) {
  const url = new URL(GSI_REVERSE_GEOCODER_URL)
  url.searchParams.set('lat', coordinates.latitude.toFixed(4))
  url.searchParams.set('lon', coordinates.longitude.toFixed(4))
  return url.toString()
}

export function normalizePlaceResponse(
  response: unknown,
  municipalities: MunicipalityMaster,
  context: { accuracyMeters: number; fetchedAt: string }
): PlaceSummary {
  const parsed = placeResponseSchema.safeParse(response)
  if (!parsed.success) throw new PlaceProviderError('PLACE_SCHEMA_ERROR')

  const code = normalizedMunicipalityCode(parsed.data.results.muniCd)
  const municipality = municipalities[code]
  const localityName = parsed.data.results.lv01Nm

  if (!municipality) {
    throw new PlaceProviderError('PLACE_MUNICIPALITY_UNKNOWN', localityName)
  }

  const administrativeName = [
    municipality.prefectureName,
    municipality.municipalityName,
    municipality.wardName
  ].filter(Boolean).join('')

  return {
    municipalityCode: municipality.code,
    prefectureName: municipality.prefectureName,
    municipalityName: municipality.municipalityName,
    ...(municipality.wardName ? { wardName: municipality.wardName } : {}),
    ...(localityName ? { localityName } : {}),
    displayName: `${administrativeName}${localityName ? ` ${localityName}` : ''}`,
    boundaryCaution: context.accuracyMeters > 250,
    providerFetchedAt: context.fetchedAt
  }
}

type ProviderOptions = {
  municipalities: MunicipalityMaster
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

export function createGsiReverseGeocoderProvider({
  municipalities,
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000
}: ProviderOptions) {
  const fetchPlace = async (coordinates: Coordinates, accuracyMeters: number) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(buildGsiReverseGeocoderUrl(coordinates), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })

      if (!response.ok) throw new PlaceProviderError('PLACE_NETWORK_ERROR')

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new PlaceProviderError('PLACE_SCHEMA_ERROR')
      }

      return normalizePlaceResponse(body, municipalities, {
        accuracyMeters,
        fetchedAt: now().toISOString()
      })
    } catch (error) {
      if (error instanceof PlaceProviderError) throw error
      if (controller.signal.aborted) throw new PlaceProviderError('PLACE_TIMEOUT')
      throw new PlaceProviderError('PLACE_NETWORK_ERROR')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return { fetchPlace }
}

export type GsiReverseGeocoderProvider = ReturnType<typeof createGsiReverseGeocoderProvider>
