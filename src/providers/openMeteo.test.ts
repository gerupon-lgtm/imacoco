import { describe, expect, it } from 'vitest'

import {
  buildOpenMeteoUrl,
  compactWeatherCodeLabel,
  normalizeApproximateElevation,
  normalizeOpenMeteoResponse,
  weatherCodeLabel
} from './openMeteo'

const responseFixture = {
  latitude: 35.68,
  longitude: 139.77,
  elevation: 10.4,
  utc_offset_seconds: 32_400,
  timezone: 'Asia/Tokyo',
  current: {
    time: 1_786_422_660,
    temperature_2m: 24.6,
    apparent_temperature: 25.1,
    weather_code: 2
  },
  current_units: {
    time: 'unixtime',
    temperature_2m: '°C',
    apparent_temperature: '°C',
    weather_code: 'wmo code'
  },
  hourly: {
    time: [1_786_419_600, 1_786_423_200, 1_786_426_800, 1_786_430_400, 1_786_434_000, 1_786_437_600, 1_786_441_200, 1_786_444_800],
    temperature_2m: [23, 25, 26, 27, 26, 24, 23, 22],
    precipitation_probability: [10, 20, 30, 40, 30, 20, 10, 10],
    weather_code: [1, 2, 2, 3, 61, 61, 2, 1]
  },
  hourly_units: {
    time: 'unixtime',
    temperature_2m: '°C',
    precipitation_probability: '%',
    weather_code: 'wmo code'
  },
  daily: {
    time: [1_786_388_400, 1_786_474_800],
    temperature_2m_max: [27, 28],
    temperature_2m_min: [19, 20],
    precipitation_probability_max: [40, 50],
    sunrise: [1_786_406_520, 1_786_493_000],
    sunset: [1_786_454_820, 1_786_541_160]
  },
  daily_units: {
    time: 'unixtime',
    temperature_2m_max: '°C',
    temperature_2m_min: '°C',
    precipitation_probability_max: '%',
    sunrise: 'unixtime',
    sunset: 'unixtime'
  }
}

describe('Open-Meteo weather provider', () => {
  it('座標を小数2桁へ丸め、仕様どおりの変数を1通信で要求する', () => {
    const url = new URL(buildOpenMeteoUrl({ latitude: 35.681236, longitude: 139.767125 }))

    expect(url.searchParams.get('latitude')).toBe('35.68')
    expect(url.searchParams.get('longitude')).toBe('139.77')
    expect(url.searchParams.get('current')).toBe('temperature_2m,apparent_temperature,weather_code')
    expect(url.searchParams.get('hourly')).toBe('temperature_2m,precipitation_probability,weather_code')
    expect(url.searchParams.get('daily')).toContain('sunrise,sunset')
    expect(url.searchParams.get('forecast_days')).toBe('2')
    expect(url.searchParams.get('timezone')).toBe('Asia/Tokyo')
    expect(url.searchParams.get('timeformat')).toBe('unixtime')
  })

  it('現在・今日・6時間・太陽・標高をUTC保存用データへ正規化する', () => {
    const result = normalizeOpenMeteoResponse(
      responseFixture,
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )

    expect(result.weather).toMatchObject({
      weatherCode: 2,
      weatherLabel: '晴れ時々くもり',
      temperatureC: 24.6,
      apparentTemperatureC: 25.1,
      todayMaxC: 27,
      todayMinC: 19,
      precipitationProbabilityMax: 40,
      elevationMeters: 10,
      modelCoordinates: { latitude: 35.68, longitude: 139.77 },
      fetchedAt: '2026-08-11T05:31:05.000Z'
    })
    expect(result.weather.nextSixHours).toHaveLength(6)
    expect(result.weather.nextSixHours[0]).toEqual({
      at: new Date(1_786_426_800_000).toISOString(),
      temperatureC: 26,
      precipitationProbability: 30,
      weatherCode: 2,
      weatherLabel: '晴れ時々くもり'
    })
    expect(result.solar).toEqual({
      localDate: '2026-08-11',
      sunriseAt: new Date(1_786_406_520_000).toISOString(),
      sunsetAt: new Date(1_786_454_820_000).toISOString(),
      fetchedAt: '2026-08-11T05:31:05.000Z'
    })
  })

  it('配列長不一致、単位不正、current/daily欠損を区別する', () => {
    expect(() => normalizeOpenMeteoResponse(
      { ...responseFixture, hourly: { ...responseFixture.hourly, weather_code: [1] } },
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'WEATHER_SCHEMA_ERROR' }))

    expect(() => normalizeOpenMeteoResponse(
      { ...responseFixture, current_units: { ...responseFixture.current_units, temperature_2m: '°F' } },
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'WEATHER_SCHEMA_ERROR' }))

    const { current: _current, ...withoutCurrent } = responseFixture
    expect(() => normalizeOpenMeteoResponse(
      withoutCurrent,
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'WEATHER_NO_CURRENT' }))

    const { daily: _daily, ...withoutDaily } = responseFixture
    expect(() => normalizeOpenMeteoResponse(
      withoutDaily,
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )).toThrowError(expect.objectContaining({ code: 'WEATHER_NO_DAILY' }))
  })

  it('標高欠損時は標高だけを省略し、未知WMOコードは汎用表示にする', () => {
    expect(normalizeApproximateElevation({})).toBeUndefined()
    expect(normalizeApproximateElevation({ elevation: Number.NaN })).toBeUndefined()
    expect(weatherCodeLabel(1234)).toBe('天気情報')

    const result = normalizeOpenMeteoResponse(
      { ...responseFixture, elevation: undefined, current: { ...responseFixture.current, weather_code: 1234 } },
      new Date('2026-08-11T05:31:00.000Z'),
      '2026-08-11T05:31:05.000Z'
    )
    expect(result.weather.elevationMeters).toBeUndefined()
    expect(result.weather.weatherLabel).toBe('天気情報')
  })

  it('時間別表示向けにWMOコードを短い天気状態へ集約する', () => {
    expect([0, 1].map(compactWeatherCodeLabel)).toEqual(['晴れ', '晴れ'])
    expect([2, 3, 45].map(compactWeatherCodeLabel)).toEqual(['くもり', 'くもり', 'くもり'])
    expect([51, 61, 80].map(compactWeatherCodeLabel)).toEqual(['雨', '雨', '雨'])
    expect([71, 85].map(compactWeatherCodeLabel)).toEqual(['雪', '雪'])
    expect(compactWeatherCodeLabel(95)).toBe('雷雨')
    expect(compactWeatherCodeLabel(1234)).toBe('天気')
  })
})
