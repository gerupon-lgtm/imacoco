import { describe, expect, it } from 'vitest'

import {
  groupStationRecords,
  searchMedicalFacilities,
  searchNearestStations,
  type MedicalFacilityRecord,
  type StationGroupRecord,
  type StationSourceRecord
} from './nearby'

const origin = { latitude: 35, longitude: 139 }
const north = (meters: number) => ({ latitude: origin.latitude + meters / 111_195, longitude: 139 })

describe('station grouping and search', () => {
  it('同名・200m未満の複数路線を1駅へまとめて重複を除く', () => {
    const records: StationSourceRecord[] = [
      { id: 'a', name: '中央駅', coordinates: north(0), lineName: 'A線', operatorName: 'A鉄道', operatorType: '1', installedEndYear: 9999 },
      { id: 'b', name: '中央駅', coordinates: north(199), lineName: 'B線', operatorName: 'B鉄道', operatorType: '1', installedEndYear: 9999 },
      { id: 'c', name: '中央駅', coordinates: north(201), lineName: 'C線', operatorName: 'C鉄道', operatorType: '1', installedEndYear: 9999 },
      { id: 'ended', name: '廃止駅', coordinates: north(50), lineName: '旧線', operatorName: '旧社', operatorType: '1', installedEndYear: 2020 }
    ]

    const groups = groupStationRecords(records, '2026-08-11')
    expect(groups).toHaveLength(2)
    expect(groups[0].lines.map((line) => line.lineName)).toEqual(['A線', 'B線'])
    expect(groups[0].sourceRelationIds).toEqual(['a', 'b'])
    expect(groups[1].lines.map((line) => line.lineName)).toEqual(['C線'])
  })

  it('30km以内を距離・駅名・IDで安定ソートして最大3件返す', () => {
    const station = (id: string, name: string, meters: number): StationGroupRecord => ({
      id,
      name,
      coordinates: north(meters),
      lines: [],
      sourceRelationIds: [id],
      installedStartYear: 2000,
      installedEndYear: 9999,
      dataVersion: '2026-08-11'
    })

    const result = searchNearestStations([
      station('d', '圏外駅', 30_010),
      station('c', 'C駅', 500),
      station('b', 'B駅', 200),
      station('a', 'A駅', 200),
      station('e', 'E駅', 700)
    ], origin, '2026-08-11')

    expect(result.stations.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    expect(result.stations[0]).toMatchObject({ direction8: '北', bearingDegrees: 0 })
    expect(result.sourceNotice).toContain('直線距離')
  })
})

describe('medical facility search', () => {
  it('10kmで不足する区分があれば30kmへ広げ、各区分を距離順3件まで返す', () => {
    const types = ['hospital', 'clinic', 'dental', 'pharmacy', 'midwifery'] as const
    const records: MedicalFacilityRecord[] = types.flatMap((type, typeIndex) => [
      { id: `${type}-1`, type, name: `${type} 1`, coordinates: north(500 + typeIndex), prefectureCode: '13', municipalityCode: '13101', sourceUpdatedAt: '2026-06-01' },
      { id: `${type}-2`, type, name: `${type} 2`, coordinates: north(9_999), prefectureCode: '13', municipalityCode: '13101', sourceUpdatedAt: '2026-06-01' },
      { id: `${type}-3`, type, name: `${type} 3`, coordinates: north(12_000), prefectureCode: '13', municipalityCode: '13101', sourceUpdatedAt: '2026-06-01' },
      { id: `${type}-4`, type, name: `${type} 4`, coordinates: north(30_010), prefectureCode: '13', municipalityCode: '13101', sourceUpdatedAt: '2026-06-01' }
    ])

    const result = searchMedicalFacilities(records, origin, '2026-06-01')
    expect(result.searchRadiusKm).toBe(30)
    expect(result.hospitals.map((item) => item.id)).toEqual(['hospital-1', 'hospital-2', 'hospital-3'])
    expect(result.clinics).toHaveLength(3)
    expect(result.dentalClinics).toHaveLength(3)
    expect(result.pharmacies).toHaveLength(3)
    expect(result.midwiferyCenters).toHaveLength(3)
    expect(result.sourceNotice).toContain('診療中')
  })

  it('全区分3件が10km以内なら検索半径を広げない', () => {
    const records: MedicalFacilityRecord[] = ['hospital', 'clinic', 'dental', 'pharmacy', 'midwifery'].flatMap((type) =>
      [1, 2, 3].map((index) => ({
        id: `${type}-${index}`,
        type: type as MedicalFacilityRecord['type'],
        name: `${type} ${index}`,
        coordinates: north(index * 100),
        prefectureCode: '13',
        municipalityCode: '13101',
        sourceUpdatedAt: '2026-06-01'
      }))
    )

    expect(searchMedicalFacilities(records, origin, '2026-06-01').searchRadiusKm).toBe(10)
  })

  it('病院・一般診療所が各3件あれば折りたたみ区分が少なくても10kmのままにする', () => {
    const primary = ['hospital', 'clinic'].flatMap((type) => [1, 2, 3].map((index) => ({
      id: `${type}-${index}`,
      type: type as MedicalFacilityRecord['type'],
      name: `${type} ${index}`,
      coordinates: north(index * 100),
      prefectureCode: '13',
      municipalityCode: '13101',
      sourceUpdatedAt: '2026-06-01'
    })))
    const secondary = ['dental', 'pharmacy', 'midwifery'].map((type, index) => ({
      id: type,
      type: type as MedicalFacilityRecord['type'],
      name: type,
      coordinates: north(500 + index),
      prefectureCode: '13',
      municipalityCode: '13101',
      sourceUpdatedAt: '2026-06-01'
    }))

    expect(searchMedicalFacilities([...primary, ...secondary], origin, '2026-06-01').searchRadiusKm).toBe(10)
  })
})
