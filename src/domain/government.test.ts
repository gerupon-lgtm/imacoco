import { describe, expect, it } from 'vitest'

import { buildGovernmentSummary, type OfficeRecord } from './government'

const offices: OfficeRecord[] = [
  {
    id: '13-pref', municipalityCode: '13', officeType: 'prefectural', name: '東京都庁',
    coordinates: { latitude: 35.6895, longitude: 139.6917 }, officialUrl: 'https://www.metro.tokyo.lg.jp/',
    sourceAddress: '新宿区西新宿2-8-1', sourceUrl: 'https://www.j-lis.go.jp/', checkedAt: '2026-08-11'
  },
  {
    id: '14100-city', municipalityCode: '14100', officeType: 'city', name: '横浜市役所',
    coordinates: { latitude: 35.4503, longitude: 139.6342 }, officialUrl: 'https://www.city.yokohama.lg.jp/',
    sourceAddress: '横浜市中区本町6-50-10', sourceUrl: 'https://www.j-lis.go.jp/', checkedAt: '2026-08-11'
  },
  {
    id: '14101-ward', municipalityCode: '14101', officeType: 'ward', name: '鶴見区役所',
    coordinates: { latitude: 35.5084, longitude: 139.6825 }, officialUrl: 'https://www.city.yokohama.lg.jp/tsurumi/',
    sourceAddress: '横浜市鶴見区鶴見中央3-20-1', sourceUrl: 'https://www.j-lis.go.jp/', checkedAt: '2026-08-11'
  },
  {
    id: '14-pref', municipalityCode: '14', officeType: 'prefectural', name: '神奈川県庁',
    coordinates: { latitude: 35.4478, longitude: 139.6425 }, officialUrl: 'https://www.pref.kanagawa.jp/',
    sourceAddress: '横浜市中区日本大通1', sourceUrl: 'https://www.j-lis.go.jp/', checkedAt: '2026-08-11'
  }
]

describe('government office lookup', () => {
  it('指定都市区は県庁・区役所を主表示し市役所を補助にする', () => {
    const result = buildGovernmentSummary(
      offices,
      { latitude: 35.506, longitude: 139.676 },
      '14101',
      '2026-08-11'
    )

    expect(result.prefecturalOffice.name).toBe('神奈川県庁')
    expect(result.jurisdictionOffice.name).toBe('鶴見区役所')
    expect(result.parentCityOffice?.name).toBe('横浜市役所')
    expect(result.jurisdictionOffice.direction8).toMatch(/北|東|南|西|現在地/)
    expect(result.jurisdictionOffice.mapUrl).not.toContain('35.506')
  })

  it('庁舎欠損と非https公式URLは表示用データにしない', () => {
    expect(() => buildGovernmentSummary(offices, { latitude: 35, longitude: 139 }, '99999', '2026-08-11'))
      .toThrowError(expect.objectContaining({ code: 'GOVERNMENT_NOT_FOUND' }))

    expect(() => buildGovernmentSummary([
      ...offices.filter((office) => office.id !== '14101-ward'),
      { ...offices[2], officialUrl: 'http://example.com' }
    ], { latitude: 35.5, longitude: 139.6 }, '14101', '2026-08-11'))
      .toThrowError(expect.objectContaining({ code: 'GOVERNMENT_INVALID_RECORD' }))
  })

  it('先頭ゼロを省いた北海道の自治体コードでも道庁と指定都市親市を解決する', () => {
    const hokkaido: OfficeRecord[] = [
      { ...offices[0], id: '1-pref', municipalityCode: '1', officeType: 'prefectural', name: '北海道庁' },
      { ...offices[1], id: '1100-city', municipalityCode: '1100', officeType: 'city', name: '札幌市役所' },
      { ...offices[2], id: '1101-ward', municipalityCode: '1101', officeType: 'ward', name: '中央区役所' }
    ]

    const result = buildGovernmentSummary(hokkaido, { latitude: 43.06, longitude: 141.35 }, '01101', '2026-08-11')

    expect(result.prefecturalOffice.name).toBe('北海道庁')
    expect(result.jurisdictionOffice.name).toBe('中央区役所')
    expect(result.parentCityOffice?.name).toBe('札幌市役所')
  })
})
