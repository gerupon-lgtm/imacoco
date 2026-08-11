import { describe, expect, it, vi } from 'vitest'

import {
  buildGsiReverseGeocoderUrl,
  createGsiReverseGeocoderProvider,
  normalizePlaceResponse,
  PlaceProviderError,
  type MunicipalityRecord
} from './gsiReverseGeocoder'

const municipalities: Record<string, MunicipalityRecord> = {
  '13101': {
    code: '13101',
    prefectureName: '東京都',
    municipalityName: '千代田区'
  },
  '14101': {
    code: '14101',
    prefectureName: '神奈川県',
    municipalityName: '横浜市',
    wardName: '鶴見区'
  }
}

describe('GSI reverse geocoder', () => {
  it('座標を小数4桁へ丸めて送信する', () => {
    const url = new URL(buildGsiReverseGeocoderUrl({ latitude: 35.681236, longitude: 139.767125 }))

    expect(url.origin + url.pathname).toBe(
      'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress'
    )
    expect(url.searchParams.get('lat')).toBe('35.6812')
    expect(url.searchParams.get('lon')).toBe('139.7671')
  })

  it('特別区と町丁目を表示名へ正規化する', () => {
    expect(normalizePlaceResponse(
      { results: { muniCd: '13101', lv01Nm: '丸の内一丁目' } },
      municipalities,
      { accuracyMeters: 18, fetchedAt: '2026-08-11T05:31:05.000Z' }
    )).toEqual({
      municipalityCode: '13101',
      prefectureName: '東京都',
      municipalityName: '千代田区',
      localityName: '丸の内一丁目',
      displayName: '東京都千代田区 丸の内一丁目',
      boundaryCaution: false,
      providerFetchedAt: '2026-08-11T05:31:05.000Z'
    })
  })

  it('指定都市区の階層と低精度の境界注意を保持する', () => {
    expect(normalizePlaceResponse(
      { results: { muniCd: '14101' } },
      municipalities,
      { accuracyMeters: 251, fetchedAt: '2026-08-11T05:31:05.000Z' }
    )).toMatchObject({
      municipalityName: '横浜市',
      wardName: '鶴見区',
      displayName: '神奈川県横浜市鶴見区',
      boundaryCaution: true
    })
  })

  it('不正応答と未知自治体コードを安全なエラーへ分ける', () => {
    expect(() => normalizePlaceResponse(
      { results: { muniCd: 13101 } },
      municipalities,
      { accuracyMeters: 10, fetchedAt: '2026-08-11T05:31:05.000Z' }
    )).toThrowError(expect.objectContaining({ code: 'PLACE_SCHEMA_ERROR' }))

    expect(() => normalizePlaceResponse(
      { results: { muniCd: '99999', lv01Nm: 'テスト町' } },
      municipalities,
      { accuracyMeters: 10, fetchedAt: '2026-08-11T05:31:05.000Z' }
    )).toThrowError(expect.objectContaining({
      code: 'PLACE_MUNICIPALITY_UNKNOWN',
      localityName: 'テスト町'
    }))
  })

  it('HTTP失敗や座標を例外文言へ混ぜない', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('座標を含む本文', { status: 500 }))
    const provider = createGsiReverseGeocoderProvider({ municipalities, fetchImpl })

    const request = provider.fetchPlace({ latitude: 35.681236, longitude: 139.767125 }, 18)
    await expect(request).rejects.toBeInstanceOf(PlaceProviderError)
    await expect(request).rejects.toMatchObject({ code: 'PLACE_NETWORK_ERROR' })
    await expect(request).rejects.not.toThrow('35.681236')
    await expect(request).rejects.not.toThrow('座標を含む本文')
  })
})
