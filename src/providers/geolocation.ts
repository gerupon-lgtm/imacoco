export type GeolocationErrorCode =
  | 'GEO_PERMISSION_DENIED'
  | 'GEO_POSITION_UNAVAILABLE'
  | 'GEO_TIMEOUT'
  | 'GEO_UNSUPPORTED'
  | 'GEO_INVALID_COORDINATE'

export type LocationFix = {
  latitude: number
  longitude: number
  accuracyMeters: number
  capturedAt: string
}

const ERROR_MESSAGES: Record<GeolocationErrorCode, string> = {
  GEO_PERMISSION_DENIED: '位置情報が許可されていません',
  GEO_POSITION_UNAVAILABLE: '現在地を確認できませんでした',
  GEO_TIMEOUT: '現在地の確認に時間がかかっています',
  GEO_UNSUPPORTED: 'この端末では現在地を取得できません',
  GEO_INVALID_COORDINATE: '現在地の値を利用できません'
}

export class GeolocationProviderError extends Error {
  constructor(public readonly code: GeolocationErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'GeolocationProviderError'
  }
}

function browserGeolocation() {
  return typeof navigator === 'undefined' ? undefined : navigator.geolocation
}

type GeolocationApi = Pick<Geolocation, 'getCurrentPosition'>

function normalizePosition(position: GeolocationPosition): LocationFix {
  const { latitude, longitude, accuracy } = position.coords
  const capturedAt = new Date(position.timestamp)
  const coordinateIsValid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180

  if (
    !coordinateIsValid ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    Number.isNaN(capturedAt.getTime())
  ) {
    throw new GeolocationProviderError('GEO_INVALID_COORDINATE')
  }

  return {
    latitude,
    longitude,
    accuracyMeters: accuracy,
    capturedAt: capturedAt.toISOString()
  }
}

function normalizeBrowserError(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED || error.code === 1) {
    return new GeolocationProviderError('GEO_PERMISSION_DENIED')
  }
  if (error.code === error.TIMEOUT || error.code === 3) {
    return new GeolocationProviderError('GEO_TIMEOUT')
  }
  return new GeolocationProviderError('GEO_POSITION_UNAVAILABLE')
}

export function createGeolocationProvider(geolocation: GeolocationApi | undefined = browserGeolocation()) {
  let inFlight: Promise<LocationFix> | undefined

  const getCurrentLocation = () => {
    if (inFlight) return inFlight

    if (!geolocation) {
      return Promise.reject<LocationFix>(new GeolocationProviderError('GEO_UNSUPPORTED'))
    }

    const request = new Promise<LocationFix>((resolve, reject) => {
      try {
        geolocation.getCurrentPosition(
          (position) => {
            try {
              resolve(normalizePosition(position))
            } catch (error) {
              reject(error)
            }
          },
          (error) => reject(normalizeBrowserError(error)),
          {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0
          }
        )
      } catch {
        reject(new GeolocationProviderError('GEO_POSITION_UNAVAILABLE'))
      }
    })

    inFlight = request
    void request.then(
      () => {
        if (inFlight === request) inFlight = undefined
      },
      () => {
        if (inFlight === request) inFlight = undefined
      }
    )
    return request
  }

  return { getCurrentLocation }
}

export type GeolocationProvider = ReturnType<typeof createGeolocationProvider>
