export type Coordinates = {
  latitude: number
  longitude: number
}

export type Direction8 = {
  label: '北' | '北東' | '東' | '南東' | '南' | '南西' | '西' | '北西'
  arrow: '↑' | '↗' | '→' | '↘' | '↓' | '↙' | '←' | '↖'
}

const EARTH_RADIUS_METERS = 6_371_008.8
const DIRECTIONS: readonly Direction8[] = [
  { label: '北', arrow: '↑' },
  { label: '北東', arrow: '↗' },
  { label: '東', arrow: '→' },
  { label: '南東', arrow: '↘' },
  { label: '南', arrow: '↓' },
  { label: '南西', arrow: '↙' },
  { label: '西', arrow: '←' },
  { label: '北西', arrow: '↖' }
]

const integerFormatter = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 })
const kilometerFormatter = new Intl.NumberFormat('ja-JP', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

function toRadians(degrees: number) {
  return degrees * Math.PI / 180
}

function assertCoordinates(coordinates: Coordinates) {
  if (
    !Number.isFinite(coordinates.latitude) ||
    !Number.isFinite(coordinates.longitude) ||
    coordinates.latitude < -90 ||
    coordinates.latitude > 90 ||
    coordinates.longitude < -180 ||
    coordinates.longitude > 180
  ) {
    throw new RangeError('緯度経度が有効な範囲ではありません')
  }
}

export function haversineDistanceMeters(from: Coordinates, to: Coordinates) {
  assertCoordinates(from)
  assertCoordinates(to)

  if (from.latitude === to.latitude && from.longitude === to.longitude) {
    return 0
  }

  const latitudeDelta = toRadians(to.latitude - from.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const fromLatitude = toRadians(from.latitude)
  const toLatitude = toRadians(to.latitude)
  const halfChord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(halfChord), Math.sqrt(1 - halfChord))
}

export function initialBearingDegrees(from: Coordinates, to: Coordinates) {
  assertCoordinates(from)
  assertCoordinates(to)

  if (from.latitude === to.latitude && from.longitude === to.longitude) {
    return undefined
  }

  const fromLatitude = toRadians(from.latitude)
  const toLatitude = toRadians(to.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude)
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta)

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function direction8FromBearing(bearingDegrees: number): Direction8 {
  if (!Number.isFinite(bearingDegrees)) {
    throw new RangeError('方位角は有限数で指定してください')
  }

  const normalized = ((bearingDegrees % 360) + 360) % 360
  const index = Math.floor((normalized + 22.5) / 45) % DIRECTIONS.length
  return DIRECTIONS[index]
}

export function formatApproximateDistance(distanceMeters: number) {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new RangeError('距離は0以上の有限数で指定してください')
  }

  if (distanceMeters < 1_000) {
    const roundedMeters = Math.round(distanceMeters / 10) * 10
    return `約${integerFormatter.format(roundedMeters)}m`
  }

  const kilometers = distanceMeters / 1_000
  if (kilometers < 10) {
    return `約${kilometerFormatter.format(kilometers)}km`
  }

  return `約${integerFormatter.format(Math.round(kilometers))}km`
}

export function roundCoordinates(coordinates: Coordinates, fractionDigits: number): Coordinates {
  assertCoordinates(coordinates)

  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 6) {
    throw new RangeError('座標の丸め桁数は0から6の整数で指定してください')
  }

  const scale = 10 ** fractionDigits
  return {
    latitude: Math.round(coordinates.latitude * scale) / scale,
    longitude: Math.round(coordinates.longitude * scale) / scale
  }
}
