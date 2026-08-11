import type { Coordinates } from './geo'
import {
  direction8FromBearing,
  haversineDistanceMeters,
  initialBearingDegrees
} from './geo'

export type StationLine = {
  lineName: string
  operatorName: string
  operatorType: string
}

export type StationSourceRecord = StationLine & {
  id: string
  name: string
  coordinates: Coordinates
  installedStartYear?: number
  installedEndYear: number
  sourceNote?: string
}

export type StationGroupRecord = {
  id: string
  name: string
  coordinates: Coordinates
  lines: StationLine[]
  sourceRelationIds: string[]
  installedStartYear: number
  installedEndYear: 9999
  sourceNote?: string
  dataVersion: string
}

export type NearbyStation = StationGroupRecord & {
  distanceMeters: number
  bearingDegrees: number
  direction8: string
}

export type StationSummary = {
  searchRadiusKm: 30
  stations: NearbyStation[]
  dataVersion: string
  sourceNotice: string
}

function normalizeStationName(name: string) {
  return name.normalize('NFKC').replace(/[\s　]+/g, '').replace(/駅$/, '')
}

function lineKey(line: StationLine) {
  return `${line.lineName}\u0000${line.operatorName}\u0000${line.operatorType}`
}

export function groupStationRecords(records: StationSourceRecord[], dataVersion: string) {
  const groups: Array<{ representative: Coordinates; records: StationSourceRecord[] }> = []

  for (const record of records
    .filter((candidate) => candidate.installedEndYear === 9999)
    .sort((left, right) => left.id.localeCompare(right.id, 'ja'))) {
    const group = groups.find((candidate) =>
      normalizeStationName(candidate.records[0].name) === normalizeStationName(record.name) &&
      haversineDistanceMeters(candidate.representative, record.coordinates) < 200
    )

    if (group) group.records.push(record)
    else groups.push({ representative: record.coordinates, records: [record] })
  }

  return groups.map(({ records: members }, index): StationGroupRecord => {
    const lines = [...new Map(members.map((member) => [lineKey(member), {
      lineName: member.lineName,
      operatorName: member.operatorName,
      operatorType: member.operatorType
    }])).values()]
      .sort((left, right) => lineKey(left).localeCompare(lineKey(right), 'ja'))
    const sourceRelationIds = members.map((member) => member.id).sort((a, b) => a.localeCompare(b, 'ja'))

    return {
      id: `station-${normalizeStationName(members[0].name)}-${sourceRelationIds[0]}-${index}`,
      name: members[0].name,
      coordinates: {
        latitude: members.reduce((sum, member) => sum + member.coordinates.latitude, 0) / members.length,
        longitude: members.reduce((sum, member) => sum + member.coordinates.longitude, 0) / members.length
      },
      lines,
      sourceRelationIds,
      installedStartYear: Math.min(...members.map((member) => member.installedStartYear ?? 999)),
      installedEndYear: 9999,
      ...(members.some((member) => member.sourceNote)
        ? { sourceNote: members.map((member) => member.sourceNote).filter(Boolean).join(' / ') }
        : {}),
      dataVersion
    }
  })
}

function nearbyDirection(origin: Coordinates, destination: Coordinates) {
  const bearing = initialBearingDegrees(origin, destination)
  return {
    bearingDegrees: bearing ?? 0,
    direction8: bearing === undefined ? '現在地' : direction8FromBearing(bearing).label
  }
}

export function searchNearestStations(
  stations: StationGroupRecord[],
  origin: Coordinates,
  dataVersion: string
): StationSummary {
  const nearby = stations
    .map((station): NearbyStation => {
      const distanceMeters = haversineDistanceMeters(origin, station.coordinates)
      return { ...station, distanceMeters, ...nearbyDirection(origin, station.coordinates) }
    })
    .filter((station) => station.distanceMeters <= 30_000)
    .sort((left, right) =>
      left.distanceMeters - right.distanceMeters ||
      left.name.localeCompare(right.name, 'ja') ||
      left.id.localeCompare(right.id, 'ja')
    )
    .slice(0, 3)

  return {
    searchRadiusKm: 30,
    stations: nearby,
    dataVersion,
    sourceNotice: '距離は直線距離です。徒歩距離・所要時間・運行状況ではありません。'
  }
}

export type MedicalFacilityType = 'hospital' | 'clinic' | 'dental' | 'pharmacy' | 'midwifery'

export type MedicalFacilityRecord = {
  id: string
  type: MedicalFacilityType
  name: string
  coordinates: Coordinates
  officialUrl?: string
  sourceDetailUrl?: string
  prefectureCode: string
  municipalityCode: string
  sourceUpdatedAt: string
}

export type NearbyMedicalFacility = MedicalFacilityRecord & {
  distanceMeters: number
  bearingDegrees: number
  direction8: string
}

export type MedicalSummary = {
  searchRadiusKm: 10 | 30
  hospitals: NearbyMedicalFacility[]
  clinics: NearbyMedicalFacility[]
  dentalClinics: NearbyMedicalFacility[]
  pharmacies: NearbyMedicalFacility[]
  midwiferyCenters: NearbyMedicalFacility[]
  dataVersion: string
  sourceNotice: string
  partialData?: boolean
  missingShardCount?: number
}

const medicalTypes: MedicalFacilityType[] = ['hospital', 'clinic', 'dental', 'pharmacy', 'midwifery']

function medicalWithin(
  records: MedicalFacilityRecord[],
  origin: Coordinates,
  radiusMeters: number
) {
  return Object.fromEntries(medicalTypes.map((type) => [type, records
    .filter((record) => record.type === type)
    .map((record): NearbyMedicalFacility => ({
      ...record,
      distanceMeters: haversineDistanceMeters(origin, record.coordinates),
      ...nearbyDirection(origin, record.coordinates)
    }))
    .filter((record) => record.distanceMeters <= radiusMeters)
    .sort((left, right) =>
      left.distanceMeters - right.distanceMeters ||
      left.name.localeCompare(right.name, 'ja') ||
      left.id.localeCompare(right.id, 'ja')
    )
    .slice(0, 3)])) as Record<MedicalFacilityType, NearbyMedicalFacility[]>
}

export function searchMedicalFacilities(
  records: MedicalFacilityRecord[],
  origin: Coordinates,
  dataVersion: string
): MedicalSummary {
  let radiusKm: 10 | 30 = 10
  let found = medicalWithin(records, origin, 10_000)
  if (found.hospital.length < 3 || found.clinic.length < 3) {
    radiusKm = 30
    found = medicalWithin(records, origin, 30_000)
  }

  return {
    searchRadiusKm: radiusKm,
    hospitals: found.hospital,
    clinics: found.clinic,
    dentalClinics: found.dental,
    pharmacies: found.pharmacy,
    midwiferyCenters: found.midwifery,
    dataVersion,
    sourceNotice: '診療中・救急受入可を示すものではありません。利用前に公式情報をご確認ください。'
  }
}
