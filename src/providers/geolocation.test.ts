import { describe, expect, it, vi } from 'vitest'

import { createGeolocationProvider } from './geolocation'

function position(latitude = 35.681236, longitude = 139.767125): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 18,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({})
    },
    timestamp: Date.parse('2026-08-11T05:31:00.000Z'),
    toJSON: () => ({})
  }
}

describe('GeolocationProvider', () => {
  it('高精度・15秒・キャッシュなしで現在地を取得する', async () => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => success(position()))
    const provider = createGeolocationProvider({ getCurrentPosition })

    await expect(provider.getCurrentLocation()).resolves.toEqual({
      latitude: 35.681236,
      longitude: 139.767125,
      accuracyMeters: 18,
      capturedAt: '2026-08-11T05:31:00.000Z'
    })
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0
    })
  })

  it('進行中の測位要求を連打時に共有する', async () => {
    let resolvePosition: PositionCallback | undefined
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => {
      resolvePosition = success
    })
    const provider = createGeolocationProvider({ getCurrentPosition })

    const first = provider.getCurrentLocation()
    const second = provider.getCurrentLocation()

    expect(first).toBe(second)
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    resolvePosition!(position())
    await expect(first).resolves.toMatchObject({ accuracyMeters: 18 })
  })

  it.each([
    [1, 'GEO_PERMISSION_DENIED'],
    [2, 'GEO_POSITION_UNAVAILABLE'],
    [3, 'GEO_TIMEOUT']
  ] as const)('ブラウザ失敗コード%sを安全なコードへ変換する', async (browserCode, expectedCode) => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((_success, error) => {
      error?.({ code: browserCode, message: '座標を含む可能性があるブラウザ文言' } as GeolocationPositionError)
    })
    const provider = createGeolocationProvider({ getCurrentPosition })

    const result = provider.getCurrentLocation()
    await expect(result).rejects.toMatchObject({ code: expectedCode })
    await expect(result).rejects.not.toThrow('座標を含む可能性があるブラウザ文言')
  })

  it('API非対応と不正座標を区別する', async () => {
    await expect(createGeolocationProvider(undefined).getCurrentLocation()).rejects.toMatchObject({
      code: 'GEO_UNSUPPORTED'
    })

    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => success(position(91, 0)))
    await expect(
      createGeolocationProvider({ getCurrentPosition }).getCurrentLocation()
    ).rejects.toMatchObject({ code: 'GEO_INVALID_COORDINATE' })
  })
})
