import type { Coordinates } from './geo'
import {
  direction8FromBearing,
  haversineDistanceMeters,
  initialBearingDegrees
} from './geo'

export type OfficeType = 'prefectural' | 'city' | 'ward' | 'town' | 'village'

export type OfficeRecord = {
  id: string
  municipalityCode: string
  officeType: OfficeType
  name: string
  coordinates: Coordinates
  officialUrl: string
  sourceAddress: string
  sourceUrl: string
  checkedAt: string
}

export type NearbyOffice = OfficeRecord & {
  distanceMeters: number
  bearingDegrees: number
  direction8: string
  mapUrl: string
}

export type GovernmentSummary = {
  prefecturalOffice: NearbyOffice
  jurisdictionOffice: NearbyOffice
  parentCityOffice?: NearbyOffice
  dataVersion: string
}

export type GovernmentErrorCode = 'GOVERNMENT_NOT_FOUND' | 'GOVERNMENT_INVALID_RECORD'

export class GovernmentDataError extends Error {
  constructor(public readonly code: GovernmentErrorCode) {
    super(code === 'GOVERNMENT_NOT_FOUND' ? '役所情報が見つかりませんでした' : '役所情報を読み取れませんでした')
    this.name = 'GovernmentDataError'
  }
}

function validHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function nearbyOffice(record: OfficeRecord, origin: Coordinates): NearbyOffice {
  if (!validHttpsUrl(record.officialUrl) || !validHttpsUrl(record.sourceUrl)) {
    throw new GovernmentDataError('GOVERNMENT_INVALID_RECORD')
  }

  let distanceMeters: number
  let bearing: number | undefined
  try {
    distanceMeters = haversineDistanceMeters(origin, record.coordinates)
    bearing = initialBearingDegrees(origin, record.coordinates)
  } catch {
    throw new GovernmentDataError('GOVERNMENT_INVALID_RECORD')
  }

  return {
    ...record,
    distanceMeters,
    bearingDegrees: bearing ?? 0,
    direction8: bearing === undefined ? '現在地' : direction8FromBearing(bearing).label,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${record.coordinates.latitude},${record.coordinates.longitude}`
  }
}

export function buildGovernmentSummary(
  records: OfficeRecord[],
  origin: Coordinates,
  municipalityCode: string,
  dataVersion: string
): GovernmentSummary {
  const normalizedCode = municipalityCode.replace(/^0+/, '')
  const paddedCode = normalizedCode.padStart(5, '0')
  const prefectureCode = paddedCode.slice(0, 2).replace(/^0+/, '')
  const prefecturalRecord = records.find((record) =>
    record.officeType === 'prefectural' && record.municipalityCode === prefectureCode
  )
  const jurisdictionRecord = records.find((record) => record.municipalityCode === normalizedCode)

  if (!prefecturalRecord || !jurisdictionRecord) {
    throw new GovernmentDataError('GOVERNMENT_NOT_FOUND')
  }

  const parentCityCode = jurisdictionRecord.officeType === 'ward'
    ? `${paddedCode.slice(0, 3)}00`.replace(/^0+/, '')
    : undefined
  const parentCityRecord = parentCityCode
    ? records.find((record) => record.municipalityCode === parentCityCode && record.officeType === 'city')
    : undefined

  return {
    prefecturalOffice: nearbyOffice(prefecturalRecord, origin),
    jurisdictionOffice: nearbyOffice(jurisdictionRecord, origin),
    ...(parentCityRecord ? { parentCityOffice: nearbyOffice(parentCityRecord, origin) } : {}),
    dataVersion
  }
}
