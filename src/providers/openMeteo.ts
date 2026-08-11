import { z } from 'zod'

import type { Coordinates } from '../domain/geo'
import { formatJstLocalDate, unixSecondsToUtcIso } from '../domain/time'

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

const finiteNumber = z.number().finite()
const probability = finiteNumber.min(0).max(100)
const weatherCode = z.number().int()

const openMeteoResponseSchema = z.object({
  latitude: finiteNumber.min(-90).max(90),
  longitude: finiteNumber.min(-180).max(180),
  elevation: finiteNumber.optional(),
  utc_offset_seconds: z.number().int(),
  timezone: z.literal('Asia/Tokyo'),
  current: z.object({
    time: finiteNumber,
    temperature_2m: finiteNumber,
    apparent_temperature: finiteNumber,
    weather_code: weatherCode
  }).optional(),
  current_units: z.object({
    time: z.literal('unixtime'),
    temperature_2m: z.literal('°C'),
    apparent_temperature: z.literal('°C'),
    weather_code: z.literal('wmo code')
  }),
  hourly: z.object({
    time: z.array(finiteNumber),
    temperature_2m: z.array(finiteNumber),
    precipitation_probability: z.array(probability),
    weather_code: z.array(weatherCode)
  }),
  hourly_units: z.object({
    time: z.literal('unixtime'),
    temperature_2m: z.literal('°C'),
    precipitation_probability: z.literal('%'),
    weather_code: z.literal('wmo code')
  }),
  daily: z.object({
    time: z.array(finiteNumber),
    temperature_2m_max: z.array(finiteNumber),
    temperature_2m_min: z.array(finiteNumber),
    precipitation_probability_max: z.array(probability),
    sunrise: z.array(finiteNumber),
    sunset: z.array(finiteNumber)
  }).optional(),
  daily_units: z.object({
    time: z.literal('unixtime'),
    temperature_2m_max: z.literal('°C'),
    temperature_2m_min: z.literal('°C'),
    precipitation_probability_max: z.literal('%'),
    sunrise: z.literal('unixtime'),
    sunset: z.literal('unixtime')
  })
})

const elevationResponseSchema = z.object({ elevation: finiteNumber.optional() }).passthrough()

export type HourlyWeather = {
  at: string
  temperatureC: number
  precipitationProbability: number
  weatherCode: number
  weatherLabel: string
}

export type WeatherSummary = {
  weatherCode: number
  weatherLabel: string
  temperatureC: number
  apparentTemperatureC: number
  todayMaxC: number
  todayMinC: number
  precipitationProbabilityMax: number
  elevationMeters?: number
  nextSixHours: HourlyWeather[]
  modelCoordinates: Coordinates
  fetchedAt: string
}

export type SolarSummary = {
  localDate: string
  sunriseAt: string
  sunsetAt: string
  fetchedAt: string
}

export type OpenMeteoSummary = {
  weather: WeatherSummary
  solar: SolarSummary
}

export type WeatherProviderErrorCode =
  | 'WEATHER_NETWORK_ERROR'
  | 'WEATHER_TIMEOUT'
  | 'WEATHER_SCHEMA_ERROR'
  | 'WEATHER_NO_CURRENT'
  | 'WEATHER_NO_DAILY'

const WEATHER_ERROR_MESSAGES: Record<WeatherProviderErrorCode, string> = {
  WEATHER_NETWORK_ERROR: '天気情報を取得できませんでした',
  WEATHER_TIMEOUT: '天気情報の取得に時間がかかっています',
  WEATHER_SCHEMA_ERROR: '天気データを読み取れませんでした',
  WEATHER_NO_CURRENT: '現在の天気情報がありません',
  WEATHER_NO_DAILY: '今日の天気情報がありません'
}

export class WeatherProviderError extends Error {
  constructor(public readonly code: WeatherProviderErrorCode) {
    super(WEATHER_ERROR_MESSAGES[code])
    this.name = 'WeatherProviderError'
  }
}

export function normalizeApproximateElevation(response: unknown) {
  const parsed = elevationResponseSchema.safeParse(response)
  return parsed.success && parsed.data.elevation !== undefined
    ? Math.round(parsed.data.elevation)
    : undefined
}

export function weatherCodeLabel(code: number) {
  if (code === 0) return '快晴'
  if (code === 1) return '晴れ'
  if (code === 2) return '晴れ時々くもり'
  if (code === 3) return 'くもり'
  if (code === 45 || code === 48) return '霧'
  if ([51, 53, 55, 56, 57].includes(code)) return '霧雨'
  if ([61, 63, 65, 66, 67].includes(code)) return '雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪'
  if ([80, 81, 82].includes(code)) return 'にわか雨'
  if ([95, 96, 99].includes(code)) return '雷雨'
  return '天気情報'
}

export function compactWeatherCodeLabel(code: number) {
  if ([0, 1].includes(code)) return '晴れ'
  if ([2, 3, 45, 48].includes(code)) return 'くもり'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '雨'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '雪'
  if ([95, 96, 99].includes(code)) return '雷雨'
  return '天気'
}

export function buildOpenMeteoUrl(coordinates: Coordinates) {
  const url = new URL(OPEN_METEO_URL)
  url.searchParams.set('latitude', coordinates.latitude.toFixed(2))
  url.searchParams.set('longitude', coordinates.longitude.toFixed(2))
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code')
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code')
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
  )
  url.searchParams.set('forecast_days', '2')
  url.searchParams.set('timezone', 'Asia/Tokyo')
  url.searchParams.set('timeformat', 'unixtime')
  return url.toString()
}

function assertEqualArrayLengths(arrays: unknown[][]) {
  const expected = arrays[0]?.length ?? 0
  if (expected === 0 || arrays.some((values) => values.length !== expected)) {
    throw new WeatherProviderError('WEATHER_SCHEMA_ERROR')
  }
}

function localDateFromDailyUnix(unixSeconds: number, utcOffsetSeconds: number) {
  return new Date((unixSeconds + utcOffsetSeconds) * 1_000).toISOString().slice(0, 10)
}

export function normalizeOpenMeteoResponse(
  response: unknown,
  currentInstant: Date,
  fetchedAt: string
): OpenMeteoSummary {
  const parsed = openMeteoResponseSchema.safeParse(response)
  if (!parsed.success) throw new WeatherProviderError('WEATHER_SCHEMA_ERROR')

  const data = parsed.data
  if (!data.current) throw new WeatherProviderError('WEATHER_NO_CURRENT')
  if (!data.daily) throw new WeatherProviderError('WEATHER_NO_DAILY')

  assertEqualArrayLengths([
    data.hourly.time,
    data.hourly.temperature_2m,
    data.hourly.precipitation_probability,
    data.hourly.weather_code
  ])
  assertEqualArrayLengths([
    data.daily.time,
    data.daily.temperature_2m_max,
    data.daily.temperature_2m_min,
    data.daily.precipitation_probability_max,
    data.daily.sunrise,
    data.daily.sunset
  ])

  const localDate = formatJstLocalDate(currentInstant)
  const todayIndex = data.daily.time.findIndex(
    (time) => localDateFromDailyUnix(time, data.utc_offset_seconds) === localDate
  )
  if (todayIndex < 0) throw new WeatherProviderError('WEATHER_NO_DAILY')

  const nowUnixSeconds = currentInstant.getTime() / 1_000
  const nextSixHours = data.hourly.time
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time >= nowUnixSeconds)
    .slice(0, 6)
    .map(({ time, index }) => ({
      at: unixSecondsToUtcIso(time),
      temperatureC: data.hourly.temperature_2m[index],
      precipitationProbability: data.hourly.precipitation_probability[index],
      weatherCode: data.hourly.weather_code[index],
      weatherLabel: weatherCodeLabel(data.hourly.weather_code[index])
    }))

  const elevationMeters = normalizeApproximateElevation(data)

  return {
    weather: {
      weatherCode: data.current.weather_code,
      weatherLabel: weatherCodeLabel(data.current.weather_code),
      temperatureC: data.current.temperature_2m,
      apparentTemperatureC: data.current.apparent_temperature,
      todayMaxC: data.daily.temperature_2m_max[todayIndex],
      todayMinC: data.daily.temperature_2m_min[todayIndex],
      precipitationProbabilityMax: data.daily.precipitation_probability_max[todayIndex],
      ...(elevationMeters === undefined ? {} : { elevationMeters }),
      nextSixHours,
      modelCoordinates: { latitude: data.latitude, longitude: data.longitude },
      fetchedAt
    },
    solar: {
      localDate,
      sunriseAt: unixSecondsToUtcIso(data.daily.sunrise[todayIndex]),
      sunsetAt: unixSecondsToUtcIso(data.daily.sunset[todayIndex]),
      fetchedAt
    }
  }
}

type OpenMeteoProviderOptions = {
  fetchImpl?: typeof fetch
  now?: () => Date
  timeoutMs?: number
}

export function createOpenMeteoProvider({
  fetchImpl = fetch,
  now = () => new Date(),
  timeoutMs = 10_000
}: OpenMeteoProviderOptions = {}) {
  const fetchWeather = async (coordinates: Coordinates) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(buildOpenMeteoUrl(coordinates), {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) throw new WeatherProviderError('WEATHER_NETWORK_ERROR')

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new WeatherProviderError('WEATHER_SCHEMA_ERROR')
      }

      const fetchedAt = now()
      return normalizeOpenMeteoResponse(body, fetchedAt, fetchedAt.toISOString())
    } catch (error) {
      if (error instanceof WeatherProviderError) throw error
      if (controller.signal.aborted) throw new WeatherProviderError('WEATHER_TIMEOUT')
      throw new WeatherProviderError('WEATHER_NETWORK_ERROR')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  return { fetchWeather }
}

export type OpenMeteoProvider = ReturnType<typeof createOpenMeteoProvider>
