import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AppIcon } from './components/AppIcon'
import { WeatherStateIcon } from './components/WeatherStateIcon'
import municipalityData from './data/municipalities.generated.json'
import { formatApproximateDistance } from './domain/geo'
import type { MedicalSummary, NearbyMedicalFacility, StationSummary } from './domain/nearby'
import type { GovernmentSummary, NearbyOffice } from './domain/government'
import { runWithOneRetry } from './domain/retry'
import {
  buildShareText,
  defaultShareSelection,
  type ShareSelection
} from './domain/share'
import { formatJstDateTime, millisecondsUntilNextMinute } from './domain/time'
import type { InstallExperience, InstallExperienceState } from './pwa/installExperience'
import { APP_DISPLAY_VERSION } from './version'
import {
  createGeolocationProvider,
  GeolocationProviderError,
  type GeolocationProvider,
  type LocationFix
} from './providers/geolocation'
import {
  createGsiReverseGeocoderProvider,
  PlaceProviderError,
  type GsiReverseGeocoderProvider,
  type MunicipalityMaster,
  type PlaceSummary
} from './providers/gsiReverseGeocoder'
import {
  compactWeatherCodeLabel,
  createOpenMeteoProvider,
  WeatherProviderError,
  type HourlyWeather,
  type OpenMeteoProvider,
  type OpenMeteoSummary
} from './providers/openMeteo'
import {
  createOpenMeteoMarineProvider,
  TideProviderError,
  type MarineResult,
  type OpenMeteoMarineProvider
} from './providers/openMeteoMarine'
import {
  createStaticStationProvider,
  StationProviderError,
  type StaticStationProvider
} from './providers/staticStations'
import {
  createStaticMedicalProvider,
  MedicalProviderError,
  type StaticMedicalProvider
} from './providers/staticMedical'
import {
  createStaticGovernmentProvider,
  StaticGovernmentError,
  type StaticGovernmentProvider
} from './providers/staticGovernment'
import { readAppSettings, updateAppSettings, type AppSettings } from './storage/appSettings'
import {
  clearAllAppData,
  deleteResourceCache,
  getLatestLocation,
  getResourceCache,
  putLatestLocation,
  putResourceCache
} from './storage/appStorage'
import {
  assessCacheEntry,
  createLocationSnapshot,
  createResourceCacheEntry
} from './storage/cachePolicy'
import './App.css'

type AppProps = {
  initialNow?: Date
  initialMode?: 'preview' | 'intro' | 'idle'
  geolocationProvider?: GeolocationProvider
  placeProvider?: GsiReverseGeocoderProvider
  weatherProvider?: OpenMeteoProvider
  tideProvider?: OpenMeteoMarineProvider
  stationProvider?: StaticStationProvider
  medicalProvider?: StaticMedicalProvider
  governmentProvider?: StaticGovernmentProvider
  installExperience?: InstallExperience
}

type LocationUiState =
  | { status: 'preview' }
  | { status: 'intro' }
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; fix: LocationFix; source: 'live' | 'cached' }
  | { status: 'error'; message: string }

type CardDataState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T; source: 'live' | 'cached' | 'stale' }
  | { status: 'error'; message: string }

const municipalityMaster = municipalityData.records as unknown as MunicipalityMaster

type CardProps = {
  id: string
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
  headingMeta?: React.ReactNode
}

function useLiveNow(initialNow?: Date) {
  const [now, setNow] = useState(() => initialNow ?? new Date())

  useEffect(() => {
    if (initialNow) return

    let timer = 0

    const schedule = () => {
      window.clearTimeout(timer)
      const current = new Date()
      setNow(current)
      timer = window.setTimeout(schedule, millisecondsUntilNextMinute(current) + 25)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') schedule()
    }

    timer = window.setTimeout(schedule, millisecondsUntilNextMinute(new Date()) + 25)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [initialNow])

  return now
}

function PinMark() {
  return (
    <svg className="pin-mark" viewBox="0 0 64 80" aria-hidden="true">
      <path d="M32 2C15.4 2 2 15 2 31c0 22 30 47 30 47s30-25 30-47C62 15 48.6 2 32 2Z" />
      <circle cx="32" cy="31" r="12" />
    </svg>
  )
}

function DashboardCard({ id, title, icon, children, className = '', headingMeta }: CardProps) {
  return (
    <section className={`info-card ${className}`} data-card-id={id}>
      <div className="card-heading">
        <span className="card-icon" aria-hidden="true">{icon}</span>
        <h2>{title}</h2>
        {headingMeta}
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}

function hasSeenIntro() {
  return readAppSettings().onboardingAccepted
}

function rememberIntro() {
  updateAppSettings({ onboardingAccepted: true })
}

function initialLocationState(initialMode?: AppProps['initialMode']): LocationUiState {
  if (initialMode) return { status: initialMode }
  return hasSeenIntro() ? { status: 'idle' } : { status: 'intro' }
}

function isPlaceSummary(value: unknown): value is PlaceSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PlaceSummary>
  return typeof candidate.displayName === 'string' &&
    typeof candidate.municipalityCode === 'string' &&
    typeof candidate.providerFetchedAt === 'string'
}

function isOpenMeteoSummary(value: unknown): value is OpenMeteoSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OpenMeteoSummary>
  const isPrecipitationAmount = (amount: unknown) =>
    typeof amount === 'number' && Number.isFinite(amount) && amount >= 0
  return Boolean(
    candidate.weather &&
    typeof candidate.weather.temperatureC === 'number' &&
    isPrecipitationAmount(candidate.weather.todayMaxHourlyPrecipitationMm) &&
    Array.isArray(candidate.weather.nextSixHours) &&
    candidate.weather.nextSixHours.every((hour) => Boolean(
      hour && typeof hour === 'object' &&
      isPrecipitationAmount((hour as Partial<HourlyWeather>).precipitationMm)
    )) &&
    candidate.solar &&
    typeof candidate.solar.sunriseAt === 'string'
  )
}

function isMarineResult(value: unknown): value is MarineResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MarineResult>
  return candidate.status === 'not_applicable' || (
    candidate.status === 'available' &&
    Array.isArray(candidate.summary?.events) &&
    typeof candidate.summary?.fetchedAt === 'string'
  )
}

function isStationSummary(value: unknown): value is StationSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StationSummary>
  return candidate.searchRadiusKm === 30 && Array.isArray(candidate.stations) && typeof candidate.dataVersion === 'string'
}

function isMedicalSummary(value: unknown): value is MedicalSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MedicalSummary>
  return (candidate.searchRadiusKm === 10 || candidate.searchRadiusKm === 30) &&
    Array.isArray(candidate.hospitals) &&
    Array.isArray(candidate.clinics) &&
    Array.isArray(candidate.dentalClinics) &&
    Array.isArray(candidate.pharmacies) &&
    Array.isArray(candidate.midwiferyCenters) &&
    typeof candidate.dataVersion === 'string'
}

function isGovernmentSummary(value: unknown): value is GovernmentSummary {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<GovernmentSummary>
  return Boolean(
    candidate.prefecturalOffice && typeof candidate.prefecturalOffice.name === 'string' &&
    candidate.jurisdictionOffice && typeof candidate.jurisdictionOffice.name === 'string' &&
    typeof candidate.dataVersion === 'string'
  )
}

const previewStationSummary: StationSummary = {
  searchRadiusKm: 30,
  dataVersion: '2025-12-31',
  sourceNotice: '距離は直線距離です。徒歩距離・所要時間・運行状況ではありません。',
  stations: [
    {
      id: 'preview-tokyo',
      name: '東京',
      coordinates: { latitude: 35.681236, longitude: 139.767125 },
      lines: [
        { lineName: 'JR線', operatorName: 'JR東日本', operatorType: '鉄道' },
        { lineName: '丸ノ内線', operatorName: '東京メトロ', operatorType: '鉄道' }
      ],
      sourceRelationIds: ['preview-tokyo'],
      installedStartYear: 1914,
      installedEndYear: 9999,
      dataVersion: '2025-12-31',
      distanceMeters: 200,
      bearingDegrees: 45,
      direction8: '北東'
    },
    {
      id: 'preview-yurakucho',
      name: '有楽町',
      coordinates: { latitude: 35.675069, longitude: 139.763328 },
      lines: [{ lineName: '山手線', operatorName: 'JR東日本', operatorType: '鉄道' }],
      sourceRelationIds: ['preview-yurakucho'],
      installedStartYear: 1910,
      installedEndYear: 9999,
      dataVersion: '2025-12-31',
      distanceMeters: 760,
      bearingDegrees: 210,
      direction8: '南西'
    },
    {
      id: 'preview-otemachi',
      name: '大手町',
      coordinates: { latitude: 35.68413, longitude: 139.762 },
      lines: [{ lineName: '東西線', operatorName: '東京メトロ', operatorType: '鉄道' }],
      sourceRelationIds: ['preview-otemachi'],
      installedStartYear: 1956,
      installedEndYear: 9999,
      dataVersion: '2025-12-31',
      distanceMeters: 820,
      bearingDegrees: 315,
      direction8: '北西'
    }
  ]
}

const previewHourlyWeather: HourlyWeather[] = [
  { at: '2026-08-11T23:00:00.000Z', temperatureC: 26, precipitationMm: 0, weatherCode: 0, weatherLabel: '快晴' },
  { at: '2026-08-12T00:00:00.000Z', temperatureC: 25, precipitationMm: 0, weatherCode: 1, weatherLabel: '晴れ' },
  { at: '2026-08-12T01:00:00.000Z', temperatureC: 25, precipitationMm: 0.2, weatherCode: 3, weatherLabel: 'くもり' },
  { at: '2026-08-12T02:00:00.000Z', temperatureC: 26, precipitationMm: 1.8, weatherCode: 61, weatherLabel: '雨' },
  { at: '2026-08-12T03:00:00.000Z', temperatureC: 26, precipitationMm: 3.4, weatherCode: 80, weatherLabel: 'にわか雨' },
  { at: '2026-08-12T04:00:00.000Z', temperatureC: 27, precipitationMm: 0, weatherCode: 2, weatherLabel: '晴れ時々くもり' }
]

function formatPrecipitationMm(value: number) {
  return `${value.toFixed(1)}mm`
}

function HourlyForecast({ hours }: { hours: HourlyWeather[] }) {
  return (
    <div className="hourly-forecast">
      {hours.map((hour) => {
        const timeLabel = formatJstDateTime(new Date(hour.at)).timeLabel
        const conditionLabel = compactWeatherCodeLabel(hour.weatherCode)
        return (
          <div
            key={hour.at}
            role="group"
            aria-label={`${timeLabel}、気温${Math.round(hour.temperatureC)}℃、${conditionLabel}、予想降水量${formatPrecipitationMm(hour.precipitationMm)}`}
          >
            <time dateTime={hour.at}>{timeLabel}</time>
            <span>{Math.round(hour.temperatureC)}℃</span>
            <span className="hourly-condition">{conditionLabel}</span>
            <span>{formatPrecipitationMm(hour.precipitationMm)}</span>
          </div>
        )
      })}
    </div>
  )
}

function PreviewDashboard() {
  return (
    <main className="dashboard">
      <DashboardCard
        id="location"
        title="いまここ"
        icon={<AppIcon name="pin" />}
        className="location-card"
        headingMeta={<time className="location-acquired" dateTime="2026-08-11T14:31:00+09:00">取得 14:31</time>}
      >
        <div className="location-layout">
          <div className="location-pin"><PinMark /></div>
          <div>
            <div className="location-name-row">
              <p className="location-name">東京都千代田区 丸の内一丁目</p>
              <a
                className="location-map-link map-action-button"
                href="https://www.google.com/maps/search/?api=1&query=35.681236,139.767125"
                target="_blank"
                rel="noreferrer"
                aria-label="現在地を地図で開く"
              ><AppIcon name="map" />地図</a>
            </div>
            <p className="location-facts">
              <span>精度の目安 ±18m</span>
              <span>標高 約10m（概算）</span>
            </p>
          </div>
        </div>
      </DashboardCard>

      <StationCard
        state={{ status: 'success', data: previewStationSummary, source: 'live' }}
        onRetry={async () => undefined}
      />

      <DashboardCard
        id="weather"
        title="天気"
        icon={<AppIcon name="sun" />}
        headingMeta={<p className="weather-daily-precipitation-note">※今日の最大1時間予想降水量です。</p>}
      >
        <div className="weather-grid">
          <div className="weather-main">
            <WeatherStateIcon weatherCode={2} className="weather-state-icon" />
            <div className="weather-current-copy">
              <strong aria-label="現在気温 24.6℃"><span>24.6</span><span className="temperature-unit">℃</span></strong>
              <p className="weather-condition">晴れ</p>
            </div>
          </div>
          <dl className="weather-details">
            <div><dt>体感</dt><dd>25.1℃</dd></div>
            <div><dt>最高</dt><dd className="warm">27℃</dd></div>
            <div><dt>最低</dt><dd className="cool">19℃</dd></div>
            <div><dt>最大雨量</dt><dd>3.4mm</dd></div>
          </dl>
        </div>
        <details className="card-details">
          <summary>この先6時間</summary>
          <HourlyForecast hours={previewHourlyWeather} />
          <p className="weather-hourly-precipitation-note">※時間別の降水量は直前1時間の予想値です。</p>
        </details>
      </DashboardCard>

      <DashboardCard id="solar" title="太陽" icon={<AppIcon name="sun" />} className="compact-card">
        <div className="split-values">
          <div><span className="solar-label"><AppIcon name="sunrise" />日の出</span><strong>05:02</strong></div>
          <div><span className="solar-label"><AppIcon name="sunset" />日の入り</span><strong>18:27</strong></div>
        </div>
      </DashboardCard>

      <DashboardCard id="tide" title="潮の目安" icon={<AppIcon name="waves" />} className="tide-card">
        <span className="badge">概算</span>
        <div className="split-values tide-values">
          <div><span>干潮</span><strong>15:18</strong></div>
          <div><span>満潮</span><strong>21:42</strong></div>
        </div>
        <div className="support-line tide-note">
          <p className="meta-line">※約12km先の海洋モデル</p>
          <p className="danger-line">航海・防災には使用不可です</p>
        </div>
      </DashboardCard>

      <DashboardCard id="government" title="役所" icon={<AppIcon name="building" />}>
        <div className="list-row"><span><strong>東京都庁</strong>　約6.7km 西</span><span className="row-actions">公式　地図</span></div>
        <div className="list-row"><span><strong>千代田区役所</strong>　約2.5km 北</span><span className="row-actions">公式　地図</span></div>
      </DashboardCard>

      <DashboardCard id="medical" title="医療機関" icon={<AppIcon name="medical" />}>
        <button type="button" className="list-row full-row"><span>病院　3件</span><AppIcon name="chevron" /></button>
        <button type="button" className="list-row full-row"><span>一般診療所　3件</span><AppIcon name="chevron" /></button>
        <div className="loading-bars" aria-label="その他の医療機関を確認中"><i /><i /><i /><i /></div>
        <div className="support-line medical-note">
          <p className="meta-line">その他の医療機関を確認中…</p>
          <p className="danger-line">緊急時は119へ</p>
          <MedicalSourceLink />
        </div>
      </DashboardCard>
      <p className="dashboard-distance-note">表示距離はすべて現在地からの直線距離です</p>
    </main>
  )
}

function PendingCard({ id, title, icon, ready }: Pick<CardProps, 'id' | 'title' | 'icon'> & { ready: boolean }) {
  return (
    <DashboardCard id={id} title={title} icon={icon}>
      <div className="pending-card" aria-live="polite">
        {ready ? (
          <>
            <span className="status-spinner" aria-hidden="true" />
            <span>情報を読み込む準備中…</span>
          </>
        ) : (
          <span>現在地の取得後に読み込みます</span>
        )}
      </div>
    </DashboardCard>
  )
}

type LiveDashboardProps = {
  locationState: Exclude<LocationUiState, { status: 'preview' } | { status: 'intro' }>
  placeState: CardDataState<PlaceSummary>
  weatherState: CardDataState<OpenMeteoSummary>
  tideState: CardDataState<MarineResult>
  stationState: CardDataState<StationSummary>
  governmentState: CardDataState<GovernmentSummary>
  medicalState: CardDataState<MedicalSummary>
  requestLocation: () => Promise<void>
  retryPlace: () => Promise<void>
  retryWeather: () => Promise<void>
  retryTide: () => Promise<void>
  retryStation: () => Promise<void>
  retryGovernment: () => Promise<void>
  retryMedical: () => Promise<void>
}

function AsyncCardMessage<T>({
  state,
  loadingLabel,
  idleLabel,
  retryLabel,
  onRetry
}: {
  state: CardDataState<T>
  loadingLabel: string
  idleLabel: string
  retryLabel: string
  onRetry: () => Promise<void>
}) {
  if (state.status === 'loading') {
    return <div className="pending-card" aria-live="polite"><span className="status-spinner" aria-hidden="true" /><span>{loadingLabel}</span></div>
  }

  if (state.status === 'error') {
    return (
      <div className="card-error" role="status">
        <p>{state.message}</p>
        <button type="button" className="secondary-button compact-button" onClick={() => void onRetry()}>{retryLabel}</button>
      </div>
    )
  }

  return <div className="pending-card"><span>{idleLabel}</span></div>
}

type DisplayStation = StationSummary['stations'][number]

function stationMapUrl(station: DisplayStation) {
  return `https://www.google.com/maps/search/?api=1&query=${station.coordinates.latitude},${station.coordinates.longitude}`
}

function StationMapLink({ station, className = '' }: { station: DisplayStation; className?: string }) {
  return (
    <a
      className={className}
      href={stationMapUrl(station)}
      target="_blank"
      rel="noreferrer"
      aria-label={`${station.name}駅を地図で開く`}
    ><AppIcon name="map" />地図</a>
  )
}

function StationRouteTags({ station }: { station: DisplayStation }) {
  const operatorNames = [...new Set(station.lines.map((line) => line.operatorName))]
  return (
    <>
      <p className="tags">
        {station.lines.slice(0, 3).map((line) => (
          <span key={`${line.operatorName}-${line.lineName}`}>{line.lineName}</span>
        ))}
      </p>
      <p className="station-operators">{operatorNames.join('・')}</p>
    </>
  )
}

function StationCard({ state, onRetry }: { state: CardDataState<StationSummary>; onRetry: () => Promise<void> }) {
  if (state.status !== 'success') {
    return (
      <DashboardCard id="station" title="最寄り駅" icon={<AppIcon name="train" />}>
        <AsyncCardMessage
          state={state}
          loadingLabel="最寄り駅を確認中…"
          idleLabel="現在地の取得後に読み込みます"
          retryLabel="駅を再試行"
          onRetry={onRetry}
        />
      </DashboardCard>
    )
  }

  if (state.data.stations.length === 0) {
    return (
      <DashboardCard id="station" title="最寄り駅" icon={<AppIcon name="train" />}>
        <div className="pending-card"><span>30km以内に駅が見つかりませんでした</span></div>
      </DashboardCard>
    )
  }

  const [nearest, ...candidates] = state.data.stations
  return (
    <DashboardCard id="station" title="最寄り駅" icon={<AppIcon name="train" />}>
      <div className="station-row">
        <div>
          <p><strong>{nearest.name}駅</strong>{' '}
            <span className="meta-inline">
              {formatApproximateDistance(nearest.distanceMeters)} {nearest.direction8}
            </span>
          </p>
          <StationRouteTags station={nearest} />
        </div>
        <StationMapLink station={nearest} className="primary-button map-action-button" />
      </div>
      {candidates.length > 0 && (
        <div className="station-note">
          <details className="inline-details station-candidates">
            <summary>ほかの駅を見る</summary>
            <div className="station-candidate-list">
              {candidates.map((station) => (
                <div className="station-candidate-row" key={station.id}>
                  <div>
                    <p><strong>{station.name}駅</strong>{' '}
                      <span className="meta-inline">
                        {formatApproximateDistance(station.distanceMeters)} {station.direction8}
                      </span>
                    </p>
                    <StationRouteTags station={station} />
                  </div>
                  <StationMapLink station={station} className="station-candidate-map" />
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </DashboardCard>
  )
}

function MedicalFacilityList({ facilities }: { facilities: NearbyMedicalFacility[] }) {
  if (facilities.length === 0) return <p className="medical-empty">この範囲では見つかりませんでした</p>
  return (
    <div className="medical-facilities">
      {facilities.map((facility) => (
        <div className="medical-facility" key={facility.id}>
          <div>
            <strong>{facility.name}</strong>
            <span>{formatApproximateDistance(facility.distanceMeters)} {facility.direction8}</span>
          </div>
          <span className="medical-actions">
            {facility.officialUrl && <a href={facility.officialUrl} target="_blank" rel="noreferrer">公式</a>}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${facility.coordinates.latitude},${facility.coordinates.longitude}`}
              target="_blank"
              rel="noreferrer"
            >地図</a>
          </span>
        </div>
      ))}
    </div>
  )
}

function MedicalSourceLink() {
  return (
    <p className="medical-source-link">
      <a href="https://www.iryou.teikyouseido.mhlw.go.jp/znk-web/juminkanja/S2300/initialize" target="_blank" rel="noreferrer">
        医療情報ネットで確認
      </a>
    </p>
  )
}

function GovernmentOfficeRow({ office, label }: { office: NearbyOffice; label: string }) {
  return (
    <div className="government-office">
      <div>
        <span>{label}</span>
        <strong>{office.name}</strong>
        <small>{formatApproximateDistance(office.distanceMeters)} {office.direction8}</small>
      </div>
      <span className="government-actions">
        <a href={office.officialUrl} target="_blank" rel="noreferrer">公式</a>
        <a href={office.mapUrl} target="_blank" rel="noreferrer">地図</a>
      </span>
    </div>
  )
}

function LiveDashboard({
  locationState,
  placeState,
  weatherState,
  tideState,
  stationState,
  governmentState,
  medicalState,
  requestLocation,
  retryPlace,
  retryWeather,
  retryTide,
  retryStation,
  retryGovernment,
  retryMedical
}: LiveDashboardProps) {
  const fix = locationState.status === 'success' ? locationState.fix : undefined
  const acquiredAt = placeState.status === 'success'
    ? placeState.data.providerFetchedAt
    : fix?.capturedAt
  const acquiredDateTime = acquiredAt ? formatJstDateTime(new Date(acquiredAt)) : undefined
  const weather = weatherState.status === 'success' ? weatherState.data.weather : undefined
  const solar = weatherState.status === 'success' ? weatherState.data.solar : undefined

  return (
    <main className="dashboard">
      <DashboardCard
        id="location"
        title="いまここ"
        icon={<AppIcon name="pin" />}
        className="location-card"
        headingMeta={acquiredAt ? (
          <time className="location-acquired" dateTime={acquiredAt}>取得 {acquiredDateTime?.timeLabel}</time>
        ) : undefined}
      >
        {locationState.status === 'success' ? (
          <div className="location-layout">
            <div className="location-pin"><PinMark /></div>
            <div>
              <div className="location-name-row">
                <p className="location-name">
                  {placeState.status === 'success'
                    ? placeState.data.displayName
                    : placeState.status === 'loading'
                      ? '地名を確認中…'
                      : '現在地を確認しました'}
                </p>
                <a
                  className="location-map-link map-action-button"
                  href={`https://www.google.com/maps/search/?api=1&query=${locationState.fix.latitude},${locationState.fix.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="現在地を地図で開く"
                ><AppIcon name="map" />地図</a>
              </div>
              <p className="location-facts">
                <span>精度の目安 ±{Math.round(locationState.fix.accuracyMeters)}m</span>
                {weather?.elevationMeters !== undefined && <span>標高 約{weather.elevationMeters}m（概算）</span>}
                {locationState.source === 'cached' && <span className="data-source-note">前回の位置</span>}
              </p>
              {placeState.status === 'error' && (
                <div className="inline-card-error" role="status">
                  <span>{placeState.message}</span>
                  <button type="button" onClick={() => void retryPlace()}>地名を再試行</button>
                </div>
              )}
              {placeState.status === 'success' && placeState.data.boundaryCaution && (
                <p className="boundary-caution">行政区域の境界付近、または測位精度が低い可能性があります</p>
              )}
            </div>
          </div>
        ) : (
          <div className={`location-status location-status--${locationState.status}`} aria-live="polite">
            {locationState.status === 'loading' ? (
              <>
                <span className="status-spinner" aria-hidden="true" />
                <span>現在地を確認中…</span>
              </>
            ) : (
              <>
                <p>{locationState.status === 'error' ? locationState.message : '現在地を取得していません'}</p>
                <button type="button" className="primary-button" onClick={() => void requestLocation()}>
                  <AppIcon name="pin" />
                  {locationState.status === 'error' ? 'もう一度試す' : '現在地を確認する'}
                </button>
              </>
            )}
          </div>
        )}
      </DashboardCard>

      <StationCard state={stationState} onRetry={retryStation} />

      <DashboardCard
        id="weather"
        title="天気"
        icon={<AppIcon name="sun" />}
        headingMeta={weather
          ? <p className="weather-daily-precipitation-note">※今日の最大1時間予想降水量です。</p>
          : undefined}
      >
        {weather ? (
          <>
            <div className="weather-grid">
              <div className="weather-main">
                <WeatherStateIcon weatherCode={weather.weatherCode} className="weather-state-icon" />
                <div className="weather-current-copy">
                  <strong aria-label={`現在気温 ${weather.temperatureC.toFixed(1)}℃`}><span>{weather.temperatureC.toFixed(1)}</span><span className="temperature-unit">℃</span></strong>
                  <p className="weather-condition">{weather.weatherLabel}</p>
                </div>
              </div>
              <dl className="weather-details">
                <div><dt>体感</dt><dd>{weather.apparentTemperatureC.toFixed(1)}℃</dd></div>
                <div><dt>最高</dt><dd className="warm">{Math.round(weather.todayMaxC)}℃</dd></div>
                <div><dt>最低</dt><dd className="cool">{Math.round(weather.todayMinC)}℃</dd></div>
                <div><dt>最大雨量</dt><dd>{formatPrecipitationMm(weather.todayMaxHourlyPrecipitationMm)}</dd></div>
              </dl>
            </div>
            {weather.nextSixHours.length > 0 && (
              <details className="card-details">
                <summary>この先6時間</summary>
                <HourlyForecast hours={weather.nextSixHours} />
                <p className="weather-hourly-precipitation-note">※時間別の降水量は直前1時間の予想値です。</p>
              </details>
            )}
          </>
        ) : (
          <AsyncCardMessage
            state={weatherState}
            loadingLabel="天気を確認中…"
            idleLabel="現在地の取得後に読み込みます"
            retryLabel="天気を再試行"
            onRetry={retryWeather}
          />
        )}
      </DashboardCard>

      <DashboardCard id="solar" title="太陽" icon={<AppIcon name="sun" />} className="compact-card">
        {solar ? (
          <div className="split-values">
            <div><span className="solar-label"><AppIcon name="sunrise" />日の出</span><strong>{formatJstDateTime(new Date(solar.sunriseAt)).timeLabel}</strong></div>
            <div><span className="solar-label"><AppIcon name="sunset" />日の入り</span><strong>{formatJstDateTime(new Date(solar.sunsetAt)).timeLabel}</strong></div>
          </div>
        ) : (
          <AsyncCardMessage
            state={weatherState}
            loadingLabel="日の出・日の入りを確認中…"
            idleLabel="現在地の取得後に読み込みます"
            retryLabel="太陽情報を再試行"
            onRetry={retryWeather}
          />
        )}
      </DashboardCard>
      <DashboardCard id="tide" title="潮の目安" icon={<AppIcon name="waves" />} className="tide-card">
        {tideState.status === 'success' && tideState.data.status === 'available' ? (
          <>
            <span className="badge">概算</span>
            <div className="split-values tide-values">
              {tideState.data.summary.events.slice(0, 2).map((event) => (
                <div key={`${event.kind}-${event.occurredAt}`}>
                  <span>{event.kind === 'high' ? '満潮' : '干潮'}の目安</span>
                  <strong>{formatJstDateTime(new Date(event.occurredAt)).timeLabel}</strong>
                </div>
              ))}
            </div>
            <div className="support-line tide-note">
              <p className="meta-line">※{formatApproximateDistance(tideState.data.summary.distanceMeters)}先の海洋モデル</p>
              <p className="danger-line">航海・防災には使用不可です</p>
            </div>
          </>
        ) : tideState.status === 'success' ? (
          <div className="pending-card"><span>近くに対象の海洋データがないため、潮の目安は表示していません</span></div>
        ) : (
          <AsyncCardMessage
            state={tideState}
            loadingLabel="潮の目安を計算中…"
            idleLabel="現在地の取得後に読み込みます"
            retryLabel="潮の目安を再試行"
            onRetry={retryTide}
          />
        )}
      </DashboardCard>
      <DashboardCard id="government" title="役所" icon={<AppIcon name="building" />}>
        {governmentState.status === 'success' ? (
          <>
            <div className="government-offices">
              <GovernmentOfficeRow office={governmentState.data.prefecturalOffice} label="都道府県庁" />
              <GovernmentOfficeRow office={governmentState.data.jurisdictionOffice} label="管轄の役所" />
            </div>
            {governmentState.data.parentCityOffice && (
              <details className="card-details government-parent">
                <summary>市役所も見る</summary>
                <GovernmentOfficeRow office={governmentState.data.parentCityOffice} label="指定都市" />
              </details>
            )}
          </>
        ) : (
          <AsyncCardMessage
            state={governmentState}
            loadingLabel="管轄の役所を確認中…"
            idleLabel="現在地の取得後に読み込みます"
            retryLabel="役所情報を再試行"
            onRetry={retryGovernment}
          />
        )}
      </DashboardCard>
      <DashboardCard id="medical" title="医療機関" icon={<AppIcon name="medical" />}>
        {medicalState.status === 'success' ? (
          <>
            <details className="medical-category" open>
              <summary>病院　{medicalState.data.hospitals.length}件</summary>
              <MedicalFacilityList facilities={medicalState.data.hospitals} />
            </details>
            <details className="medical-category" open>
              <summary>一般診療所　{medicalState.data.clinics.length}件</summary>
              <MedicalFacilityList facilities={medicalState.data.clinics} />
            </details>
            <details className="medical-category">
              <summary>歯科診療所　{medicalState.data.dentalClinics.length}件</summary>
              <MedicalFacilityList facilities={medicalState.data.dentalClinics} />
            </details>
            <details className="medical-category">
              <summary>薬局　{medicalState.data.pharmacies.length}件</summary>
              <MedicalFacilityList facilities={medicalState.data.pharmacies} />
            </details>
            <details className="medical-category">
              <summary>助産所　{medicalState.data.midwiferyCenters.length}件</summary>
              <MedicalFacilityList facilities={medicalState.data.midwiferyCenters} />
            </details>
            <div className="support-line medical-note">
              <p className="meta-line">半径{medicalState.data.searchRadiusKm}km・受診前に公式情報を確認して下さい</p>
              <p className="danger-line">緊急時は119へ</p>
              <MedicalSourceLink />
            </div>
            {medicalState.data.partialData && <p className="data-source-note">周辺データの一部を取得できませんでした</p>}
          </>
        ) : (
          <AsyncCardMessage
            state={medicalState}
            loadingLabel="周辺の医療機関を確認中…"
            idleLabel="現在地の取得後に読み込みます"
            retryLabel="医療機関を再試行"
            onRetry={retryMedical}
          />
        )}
      </DashboardCard>
      <p className="dashboard-distance-note">表示距離はすべて現在地からの直線距離です</p>
    </main>
  )
}

export function App({
  initialNow,
  initialMode,
  geolocationProvider,
  placeProvider,
  weatherProvider,
  tideProvider,
  stationProvider,
  medicalProvider,
  governmentProvider,
  installExperience
}: AppProps) {
  const now = useLiveNow(initialNow)
  const dateTime = useMemo(() => formatJstDateTime(now), [now])
  const locationProvider = useMemo(
    () => geolocationProvider ?? createGeolocationProvider(),
    [geolocationProvider]
  )
  const resolvedPlaceProvider = useMemo(
    () => placeProvider ?? createGsiReverseGeocoderProvider({ municipalities: municipalityMaster }),
    [placeProvider]
  )
  const resolvedWeatherProvider = useMemo(
    () => weatherProvider ?? createOpenMeteoProvider(),
    [weatherProvider]
  )
  const resolvedTideProvider = useMemo(
    () => tideProvider ?? createOpenMeteoMarineProvider(),
    [tideProvider]
  )
  const resolvedStationProvider = useMemo(
    () => stationProvider ?? createStaticStationProvider(),
    [stationProvider]
  )
  const resolvedMedicalProvider = useMemo(
    () => medicalProvider ?? createStaticMedicalProvider(),
    [medicalProvider]
  )
  const resolvedGovernmentProvider = useMemo(
    () => governmentProvider ?? createStaticGovernmentProvider(),
    [governmentProvider]
  )
  const [locationState, setLocationState] = useState<LocationUiState>(() => initialLocationState(initialMode))
  const [placeState, setPlaceState] = useState<CardDataState<PlaceSummary>>({ status: 'idle' })
  const [weatherState, setWeatherState] = useState<CardDataState<OpenMeteoSummary>>({ status: 'idle' })
  const [tideState, setTideState] = useState<CardDataState<MarineResult>>({ status: 'idle' })
  const [stationState, setStationState] = useState<CardDataState<StationSummary>>({ status: 'idle' })
  const [governmentState, setGovernmentState] = useState<CardDataState<GovernmentSummary>>({ status: 'idle' })
  const [medicalState, setMedicalState] = useState<CardDataState<MedicalSummary>>({ status: 'idle' })
  const [openPanel, setOpenPanel] = useState<'info' | 'share' | 'delete' | null>(null)
  const [clearStatus, setClearStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [shareSelection, setShareSelection] = useState<ShareSelection>(defaultShareSelection)
  const [shareFallback, setShareFallback] = useState<'idle' | 'manual'>('idle')
  const [pwaUpdateState, setPwaUpdateState] = useState<'idle' | 'available' | 'loading'>('idle')
  const [themeMode, setThemeMode] = useState<AppSettings['theme']>(() => readAppSettings().theme)
  const [installState, setInstallState] = useState<InstallExperienceState>(
    () => installExperience?.getState() ?? 'installed'
  )
  const [installPromptSeen, setInstallPromptSeen] = useState(
    () => readAppSettings().installPromptSeen
  )
  const [installActionState, setInstallActionState] = useState<'idle' | 'loading'>('idle')
  const [toast, setToast] = useState<string>()
  const requestVersion = useRef(0)
  const latestFix = useRef<LocationFix | undefined>(undefined)
  const latestPlace = useRef<PlaceSummary | undefined>(undefined)

  useEffect(() => {
    const handleUpdate = () => setPwaUpdateState('available')
    const handleOfflineReady = () => setToast('オフラインでも前回の画面を開けるようになりました')
    window.addEventListener('imakoko:pwa-update', handleUpdate)
    window.addEventListener('imakoko:pwa-offline-ready', handleOfflineReady)
    return () => {
      window.removeEventListener('imakoko:pwa-update', handleUpdate)
      window.removeEventListener('imakoko:pwa-offline-ready', handleOfflineReady)
    }
  }, [])

  useEffect(() => {
    if (!installExperience) return
    const syncInstallState = () => setInstallState(installExperience.getState())
    syncInstallState()
    return installExperience.subscribe(syncInstallState)
  }, [installExperience])

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : undefined
    const applyTheme = () => {
      const resolvedTheme = themeMode === 'system'
        ? mediaQuery?.matches ? 'dark' : 'light'
        : themeMode
      document.documentElement.dataset.theme = themeMode
      document.documentElement.dataset.colorMode = resolvedTheme
      document.documentElement.style.colorScheme = resolvedTheme
    }

    applyTheme()
    if (themeMode !== 'system') return
    mediaQuery?.addEventListener('change', applyTheme)
    return () => mediaQuery?.removeEventListener('change', applyTheme)
  }, [themeMode])

  const changeThemeMode = (theme: AppSettings['theme']) => {
    setThemeMode(theme)
    updateAppSettings({ theme })
  }

  const fetchPlace = useCallback(async (fix: LocationFix, version: number, forceRefresh = false) => {
    setPlaceState({ status: 'loading' })
    let staleData: PlaceSummary | undefined

    try {
      const cached = await getResourceCache<PlaceSummary>('place')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        if (!isPlaceSummary(cached.payload)) {
          void deleteResourceCache('place').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setPlaceState({ status: 'success', data: cached.payload, source: 'cached' })
            latestPlace.current = cached.payload
          }
          return cached.payload
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('place').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block a live provider request.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedPlaceProvider.fetchPlace(fix, fix.accuracyMeters),
        (error) => error instanceof PlaceProviderError && ['PLACE_NETWORK_ERROR', 'PLACE_TIMEOUT'].includes(error.code)
      )
      if (requestVersion.current === version) {
        setPlaceState({ status: 'success', data, source: 'live' })
        latestPlace.current = data
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'place',
          origin: fix,
          payload: data,
          provider: 'gsi-reverse-geocoder',
          fetchedAt: new Date(data.providerFetchedAt)
        })).catch(() => undefined)
      }
      return data
    } catch (error) {
      if (requestVersion.current !== version) return
      if (staleData) {
        setPlaceState({ status: 'success', data: staleData, source: 'stale' })
        latestPlace.current = staleData
        return staleData
      } else {
        setPlaceState({
          status: 'error',
          message: error instanceof PlaceProviderError ? error.message : '地名を取得できませんでした'
        })
      }
      return undefined
    }
  }, [resolvedPlaceProvider])

  const fetchWeather = useCallback(async (fix: LocationFix, version: number, forceRefresh = false) => {
    setWeatherState({ status: 'loading' })
    let staleData: OpenMeteoSummary | undefined

    try {
      const cached = await getResourceCache<OpenMeteoSummary>('weather')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        if (!isOpenMeteoSummary(cached.payload)) {
          void deleteResourceCache('weather').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setWeatherState({ status: 'success', data: cached.payload, source: 'cached' })
          }
          return
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('weather').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block a live provider request.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedWeatherProvider.fetchWeather(fix),
        (error) => error instanceof WeatherProviderError && ['WEATHER_NETWORK_ERROR', 'WEATHER_TIMEOUT'].includes(error.code)
      )
      if (requestVersion.current === version) {
        setWeatherState({ status: 'success', data, source: 'live' })
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'weather',
          origin: fix,
          payload: data,
          provider: 'open-meteo-weather',
          fetchedAt: new Date(data.weather.fetchedAt)
        })).catch(() => undefined)
      }
    } catch {
      if (requestVersion.current !== version) return
      if (staleData) {
        setWeatherState({ status: 'success', data: staleData, source: 'stale' })
      } else {
        setWeatherState({ status: 'error', message: '天気情報を取得できませんでした' })
      }
    }
  }, [resolvedWeatherProvider])

  const fetchTide = useCallback(async (fix: LocationFix, version: number, forceRefresh = false) => {
    setTideState({ status: 'loading' })
    let staleData: MarineResult | undefined

    try {
      const cached = await getResourceCache<MarineResult>('tide')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        if (!isMarineResult(cached.payload)) {
          void deleteResourceCache('tide').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setTideState({ status: 'success', data: cached.payload, source: 'cached' })
          }
          return
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('tide').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block a live provider request.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedTideProvider.fetchTide(fix),
        (error) => error instanceof TideProviderError && ['TIDE_NETWORK_ERROR', 'TIDE_TIMEOUT'].includes(error.code)
      )
      const fetchedAt = data.status === 'available' ? data.summary.fetchedAt : new Date().toISOString()
      if (requestVersion.current === version) {
        setTideState({ status: 'success', data, source: 'live' })
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'tide',
          origin: fix,
          payload: data,
          provider: 'open-meteo-marine',
          fetchedAt: new Date(fetchedAt)
        })).catch(() => undefined)
      }
    } catch {
      if (requestVersion.current !== version) return
      if (staleData) {
        setTideState({ status: 'success', data: staleData, source: 'stale' })
      } else {
        setTideState({ status: 'error', message: '潮の目安を取得できませんでした' })
      }
    }
  }, [resolvedTideProvider])

  const fetchStation = useCallback(async (fix: LocationFix, version: number, forceRefresh = false) => {
    setStationState({ status: 'loading' })
    let staleData: StationSummary | undefined

    try {
      const cached = await getResourceCache<StationSummary>('station')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        if (!isStationSummary(cached.payload)) {
          void deleteResourceCache('station').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setStationState({ status: 'success', data: cached.payload, source: 'cached' })
          }
          return
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('station').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block static station loading.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedStationProvider.fetchStations(fix),
        (error) => error instanceof StationProviderError && error.code !== 'STATION_SCHEMA_ERROR'
      )
      if (requestVersion.current === version) {
        setStationState({ status: 'success', data, source: 'live' })
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'station',
          origin: fix,
          payload: data,
          provider: 'mlit-n05-static',
          fetchedAt: new Date(),
          dataVersion: data.dataVersion
        })).catch(() => undefined)
      }
    } catch {
      if (requestVersion.current !== version) return
      if (staleData) {
        setStationState({ status: 'success', data: staleData, source: 'stale' })
      } else {
        setStationState({ status: 'error', message: '最寄り駅を確認できませんでした' })
      }
    }
  }, [resolvedStationProvider])

  const fetchMedical = useCallback(async (fix: LocationFix, version: number, forceRefresh = false) => {
    setMedicalState({ status: 'loading' })
    let staleData: MedicalSummary | undefined

    try {
      const cached = await getResourceCache<MedicalSummary>('medical')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        if (!isMedicalSummary(cached.payload)) {
          void deleteResourceCache('medical').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setMedicalState({ status: 'success', data: cached.payload, source: 'cached' })
          }
          return
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('medical').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block static medical loading.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedMedicalProvider.fetchMedical(fix),
        (error) => error instanceof MedicalProviderError && error.code !== 'MEDICAL_SCHEMA_ERROR'
      )
      if (requestVersion.current === version) {
        setMedicalState({ status: 'success', data, source: 'live' })
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'medical',
          origin: fix,
          payload: data,
          provider: 'mhlw-medical-static',
          fetchedAt: new Date(),
          dataVersion: data.dataVersion
        })).catch(() => undefined)
      }
    } catch {
      if (requestVersion.current !== version) return
      if (staleData) {
        setMedicalState({ status: 'success', data: staleData, source: 'stale' })
      } else {
        setMedicalState({ status: 'error', message: '周辺の医療機関を確認できませんでした' })
      }
    }
  }, [resolvedMedicalProvider])

  const fetchGovernment = useCallback(async (
    fix: LocationFix,
    municipalityCode: string,
    version: number,
    forceRefresh = false
  ) => {
    if (requestVersion.current !== version) return
    setGovernmentState({ status: 'loading' })
    let staleData: GovernmentSummary | undefined
    const normalizedCode = municipalityCode.replace(/^0+/, '')

    try {
      const cached = await getResourceCache<GovernmentSummary>('government')
      if (cached) {
        const assessment = assessCacheEntry(cached, fix, new Date())
        const cacheMatchesMunicipality = isGovernmentSummary(cached.payload) &&
          cached.payload.jurisdictionOffice.municipalityCode.replace(/^0+/, '') === normalizedCode
        if (!cacheMatchesMunicipality) {
          void deleteResourceCache('government').catch(() => undefined)
        } else if (assessment === 'fresh' && !forceRefresh) {
          if (requestVersion.current === version) {
            setGovernmentState({ status: 'success', data: cached.payload, source: 'cached' })
          }
          return
        } else if (assessment === 'stale') {
          staleData = cached.payload
        } else if (assessment === 'expired') {
          void deleteResourceCache('government').catch(() => undefined)
        }
      }
    } catch {
      // Cache failure must not block static government loading.
    }

    try {
      const data = await runWithOneRetry(
        () => resolvedGovernmentProvider.fetchGovernment(fix, municipalityCode),
        (error) => error instanceof StaticGovernmentError && error.code !== 'GOVERNMENT_NOT_FOUND'
      )
      if (requestVersion.current === version) {
        setGovernmentState({ status: 'success', data, source: 'live' })
        void putResourceCache(createResourceCacheEntry({
          resourceType: 'government',
          origin: fix,
          payload: data,
          provider: 'government-static',
          fetchedAt: new Date(),
          dataVersion: data.dataVersion
        })).catch(() => undefined)
      }
    } catch {
      if (requestVersion.current !== version) return
      if (staleData) {
        setGovernmentState({ status: 'success', data: staleData, source: 'stale' })
      } else {
        setGovernmentState({ status: 'error', message: '管轄の役所を確認できませんでした' })
      }
    }
  }, [resolvedGovernmentProvider])

  const fetchDashboard = useCallback((fix: LocationFix, forceRefresh = false) => {
    const version = ++requestVersion.current
    latestFix.current = fix
    latestPlace.current = undefined
    setGovernmentState({ status: 'loading' })
    void fetchPlace(fix, version, forceRefresh).then((place) => {
      if (requestVersion.current === version && place) {
        void fetchGovernment(fix, place.municipalityCode, version, forceRefresh)
      } else if (requestVersion.current === version) {
        setGovernmentState({ status: 'error', message: '地名を確認できないため役所を特定できませんでした' })
      }
    })
    void fetchWeather(fix, version, forceRefresh)
    void fetchTide(fix, version, forceRefresh)
    void fetchStation(fix, version, forceRefresh)
    void fetchMedical(fix, version, forceRefresh)
  }, [fetchGovernment, fetchMedical, fetchPlace, fetchStation, fetchTide, fetchWeather])

  const requestLocation = useCallback(async (forceRefresh = false) => {
    rememberIntro()
    setLocationState({ status: 'loading' })

    try {
      const fix = await locationProvider.getCurrentLocation()
      setLocationState({ status: 'success', fix, source: 'live' })
      void putLatestLocation(createLocationSnapshot(fix)).catch(() => undefined)
      fetchDashboard(fix, forceRefresh)
    } catch (error) {
      const cachedLocation = await getLatestLocation().catch(() => undefined)
      if (cachedLocation) {
        const fix: LocationFix = {
          ...cachedLocation.coordinates,
          accuracyMeters: cachedLocation.accuracyMeters,
          capturedAt: cachedLocation.acquiredAt
        }
        setLocationState({ status: 'success', fix, source: 'cached' })
        setToast('現在地を取得できないため、24時間以内の前回位置を表示しています')
        fetchDashboard(fix)
        return
      }

      ++requestVersion.current
      latestFix.current = undefined
      latestPlace.current = undefined
      setPlaceState({ status: 'idle' })
      setWeatherState({ status: 'idle' })
      setTideState({ status: 'idle' })
      setStationState({ status: 'idle' })
      setGovernmentState({ status: 'idle' })
      setMedicalState({ status: 'idle' })
      setLocationState({
        status: 'error',
        message: error instanceof GeolocationProviderError
          ? error.message
          : '現在地を確認できませんでした'
      })
    }
  }, [fetchDashboard, locationProvider])

  const retryPlace = useCallback(async () => {
    if (!latestFix.current) return
    await fetchPlace(latestFix.current, requestVersion.current, true)
  }, [fetchPlace])

  const retryWeather = useCallback(async () => {
    if (!latestFix.current) return
    await fetchWeather(latestFix.current, requestVersion.current, true)
  }, [fetchWeather])

  const retryTide = useCallback(async () => {
    if (!latestFix.current) return
    await fetchTide(latestFix.current, requestVersion.current, true)
  }, [fetchTide])

  const retryStation = useCallback(async () => {
    if (!latestFix.current) return
    await fetchStation(latestFix.current, requestVersion.current, true)
  }, [fetchStation])

  const retryGovernment = useCallback(async () => {
    if (!latestFix.current || !latestPlace.current) return
    await fetchGovernment(latestFix.current, latestPlace.current.municipalityCode, requestVersion.current, true)
  }, [fetchGovernment])

  const retryMedical = useCallback(async () => {
    if (!latestFix.current) return
    await fetchMedical(latestFix.current, requestVersion.current, true)
  }, [fetchMedical])

  useEffect(() => {
    if (initialMode === undefined && locationState.status === 'idle' && hasSeenIntro()) {
      void requestLocation()
    }
    // Auto-request is intentionally limited to the initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const skipIntro = () => {
    rememberIntro()
    setLocationState({ status: 'idle' })
  }

  const clearSavedData = async () => {
    setClearStatus('loading')
    try {
      await clearAllAppData()
      ++requestVersion.current
      latestFix.current = undefined
      latestPlace.current = undefined
      setLocationState({ status: 'intro' })
      setPlaceState({ status: 'idle' })
      setWeatherState({ status: 'idle' })
      setTideState({ status: 'idle' })
      setStationState({ status: 'idle' })
      setGovernmentState({ status: 'idle' })
      setMedicalState({ status: 'idle' })
      setThemeMode('system')
      setInstallPromptSeen(false)
      setInstallActionState('idle')
      setOpenPanel(null)
      setClearStatus('idle')
      setToast('保存データを消去しました')
    } catch {
      setClearStatus('error')
    }
  }

  const isIntro = locationState.status === 'intro'
  const isPreview = locationState.status === 'preview'
  const showInstallGuidance = !isIntro
    && openPanel === null
    && !installPromptSeen
    && (installState === 'ios' || installState === 'installable')

  const dismissInstallGuidance = useCallback(() => {
    updateAppSettings({ installPromptSeen: true })
    setInstallPromptSeen(true)
    setInstallActionState('idle')
  }, [])

  const requestInstall = useCallback(async () => {
    if (!installExperience || installActionState === 'loading') return
    setInstallActionState('loading')
    try {
      await installExperience.install()
    } catch {
      // Browser install prompts are optional; failure must not interrupt the dashboard.
    } finally {
      dismissInstallGuidance()
    }
  }, [dismissInstallGuidance, installActionState, installExperience])

  useEffect(() => {
    if (!showInstallGuidance) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissInstallGuidance()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [dismissInstallGuidance, showInstallGuidance])

  const dashboardSources = [placeState, weatherState, tideState, stationState, governmentState, medicalState]
    .flatMap((state) => state.status === 'success' ? [state.source] : [])
  const dashboardSourceNotice = dashboardSources.includes('stale')
    ? '一部に通信できないため前回値を表示しています'
    : dashboardSources.includes('cached')
      ? '一部に15分以内の保存済み情報を表示しています'
      : undefined
  const checkedDateTime = locationState.status === 'success'
    ? formatJstDateTime(new Date(locationState.fix.capturedAt))
    : undefined
  const tideForShare = tideState.status === 'success' && tideState.data.status === 'available'
    ? tideState.data.summary.events.slice(0, 2).map((event) =>
      `${event.kind === 'high' ? '満潮' : '干潮'}の目安 ${formatJstDateTime(new Date(event.occurredAt)).timeLabel}`
    ).join('／')
    : undefined
  const shareContent = {
    place: placeState.status === 'success' ? placeState.data.displayName : undefined,
    checkedAt: checkedDateTime ? `${checkedDateTime.dateLabel} ${checkedDateTime.timeLabel}` : undefined,
    weather: weatherState.status === 'success'
      ? `${weatherState.data.weather.weatherLabel} ${weatherState.data.weather.temperatureC.toFixed(1)}℃`
      : undefined,
    solar: weatherState.status === 'success'
      ? `日の出 ${formatJstDateTime(new Date(weatherState.data.solar.sunriseAt)).timeLabel}／日の入り ${formatJstDateTime(new Date(weatherState.data.solar.sunsetAt)).timeLabel}`
      : undefined,
    tide: tideForShare,
    government: governmentState.status === 'success'
      ? `管轄の役所 ${governmentState.data.jurisdictionOffice.name}`
      : undefined
  }
  const shareAppUrl = typeof window === 'undefined'
    ? undefined
    : `${window.location.origin}${window.location.pathname}`
  const shareText = buildShareText(shareContent, shareSelection, shareAppUrl)

  const updateShareSelection = (key: keyof ShareSelection, checked: boolean) => {
    setShareSelection((current) => ({ ...current, [key]: checked }))
  }

  const copyShareText = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(shareText)
      setOpenPanel(null)
      setToast('共有内容をコピーしました')
    } catch {
      setShareFallback('manual')
    }
  }

  const performShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'いまここインフォ', text: shareText })
        setOpenPanel(null)
        setToast('共有画面を開きました')
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copyShareText()
  }

  const applyPwaUpdate = async () => {
    if (!window.__IMAKOKO_UPDATE_SW__) return
    setPwaUpdateState('loading')
    try {
      await window.__IMAKOKO_UPDATE_SW__()
    } catch {
      setPwaUpdateState('available')
      setToast('更新できませんでした。通信を確認してもう一度お試しください')
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <img className="brand-icon" src="/favicon.svg" alt="" />
          <div className="brand-copy">
            <h1>いまここインフォ</h1>
            <p className="brand-slug">imacoco-info</p>
            <p className="copyright">© 2026 SIKUMI LAB</p>
          </div>
        </div>
        <div className="header-tools">
          {!isIntro && <div className="header-actions" aria-label="画面操作">
            <button
              type="button"
              className="header-button"
              aria-label="現在地の情報を更新"
              onClick={isPreview ? undefined : () => void requestLocation(true)}
              disabled={locationState.status === 'loading'}
            >
              <AppIcon name="refresh" className="header-action-icon" />
              更新
            </button>
            <button
              type="button"
              className="header-button"
              aria-label="表示内容を共有"
              onClick={() => { setShareFallback('idle'); setOpenPanel('share') }}
            >
              <AppIcon name="share" className="header-action-icon" />
              共有
            </button>
          </div>}
          <div className="header-meta">
            <label className="theme-picker">
              <select
                aria-label="表示色モード"
                value={themeMode}
                onChange={(event) => changeThemeMode(event.target.value as AppSettings['theme'])}
              >
                <option value="light">ライト</option>
                <option value="dark">ダーク</option>
                <option value="system">自動</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      {pwaUpdateState !== 'idle' && (
        <div className="pwa-update-banner" role="status">
          <span>新しい版を利用できます</span>
          <span>
            <button type="button" disabled={pwaUpdateState === 'loading'} onClick={() => setPwaUpdateState('idle')}>あとで</button>
            <button type="button" disabled={pwaUpdateState === 'loading'} onClick={() => void applyPwaUpdate()}>
              {pwaUpdateState === 'loading' ? '更新中…' : '更新する'}
            </button>
          </span>
        </div>
      )}

      <div className="date-rail" aria-label="現在の日本時間">
        <time className="current-date" dateTime={now.toISOString()}>{dateTime.dateLabel}</time>
        <time className="current-clock" dateTime={now.toISOString()}>
          <AppIcon name="clock" /> {dateTime.timeLabel}
        </time>
      </div>

      {isIntro ? (
        <main className="intro-panel">
          <div className="intro-icon"><PinMark /></div>
          <p className="intro-kicker">この場所の情報を、ひと目で</p>
          <h2>現在地から、いま必要な情報をまとめます</h2>
          <p className="intro-copy">住所・天気・太陽・潮の目安・最寄り駅・役所・医療機関を、ひとつの画面で確認できます。</p>
          <ul className="intro-list">
            <li>位置情報は表示に必要な範囲で外部の情報源へ送信します</li>
            <li>アカウント登録や行動分析は行いません</li>
            <li>次回からは起動時に現在地を確認します</li>
          </ul>
          <div className="intro-actions">
            <button type="button" className="primary-button intro-primary" onClick={() => void requestLocation()}>
              <AppIcon name="pin" />現在地で表示
            </button>
            <button type="button" className="secondary-button" onClick={skipIntro}>今は使わない</button>
          </div>
          <p className="intro-privacy">端末の位置情報の許可は、ボタンを押したあとに確認されます。</p>
        </main>
      ) : isPreview ? (
        <PreviewDashboard />
      ) : (
        <LiveDashboard
          locationState={locationState}
          placeState={placeState}
          weatherState={weatherState}
          tideState={tideState}
          stationState={stationState}
          governmentState={governmentState}
          medicalState={medicalState}
          requestLocation={requestLocation}
          retryPlace={retryPlace}
          retryWeather={retryWeather}
          retryTide={retryTide}
          retryStation={retryStation}
          retryGovernment={retryGovernment}
          retryMedical={retryMedical}
        />
      )}

      <footer className="app-footer">
        <button type="button" onClick={() => setOpenPanel('info')}><span className="footer-label"><AppIcon name="shield" />出典・プライバシー</span><AppIcon name="chevron" /></button>
        <button type="button" onClick={() => { setClearStatus('idle'); setOpenPanel('delete') }}><span className="footer-label"><AppIcon name="trash" />保存データを消去</span><AppIcon name="chevron" /></button>
        <div className="footer-meta">
          {dashboardSourceNotice && <span className="footer-source-note"><AppIcon name="clock" />{dashboardSourceNotice}</span>}
          <small>{APP_DISPLAY_VERSION}</small>
        </div>
      </footer>

      {openPanel && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && clearStatus !== 'loading') setOpenPanel(null)
        }}>
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${openPanel}-panel-title`}
          >
            {openPanel === 'info' ? (
              <>
                <h2 id="info-panel-title">出典・プライバシー</h2>
                <p>位置情報や表示内容を本アプリのサーバーへ保存せず、アカウント登録・位置履歴の蓄積・アクセス解析は行いません。外部APIには下記の丸めた座標だけを送信します。</p>
                <dl className="source-list">
                  <div><dt>地名・行政区域</dt><dd><a href="https://maps.gsi.go.jp/" target="_blank" rel="noreferrer">国土地理院</a>へ小数4桁に丸めた座標を送信</dd></div>
                  <div><dt>天気・太陽・概算標高</dt><dd><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open-Meteo</a>へ小数2桁に丸めた座標を送信</dd></div>
                  <div><dt>潮の目安</dt><dd><a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noreferrer">Open-Meteo Marine</a>へ小数2桁に丸めた座標を送信し、海面モデルから概算（実測の潮汐表ではありません）</dd></div>
                  <div><dt>最寄り駅</dt><dd><a href="https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N05-2025.html" target="_blank" rel="noreferrer">国土数値情報 鉄道データ N05</a>（2025-12-31、非商用条件）を端末内で検索</dd></div>
                  <div><dt>役所</dt><dd><a href="https://amano-tec.com/data/localgovernments.html" target="_blank" rel="noreferrer">アマノ技研 全国市町村役場データ</a>（2026-01-15）を基礎に、<a href="https://www.digital.go.jp/resources/data_local_governments" target="_blank" rel="noreferrer">デジタル庁</a>・<a href="https://www.j-lis.go.jp/spd/map-search/cms_1069.html" target="_blank" rel="noreferrer">J-LIS</a>の確認先を併用</dd></div>
                  <div><dt>医療機関</dt><dd><a href="https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html" target="_blank" rel="noreferrer">厚生労働省 医療情報ネットのオープンデータ</a>（2026-06-01、公共データ利用規約 第1.0版）を端末内で検索</dd></div>
                  <div><dt>端末内の保存</dt><dd>最新1地点と表示用データを、オフライン時の前回表示のためこの端末だけに最大24時間保存</dd></div>
                </dl>
                <p className="modal-note">標高は90m地形モデル由来の概算です。防災・登山・測量には使用できません。潮の目安も航海・防災には使用できません。医療機関の診療内容・受付状況は変わるため、受診前に公式情報を確認してください。緊急時は119番へ連絡してください。</p>
                <p className="modal-version">アプリ版 {APP_DISPLAY_VERSION}</p>
                <button type="button" className="primary-button modal-close" onClick={() => setOpenPanel(null)}>閉じる</button>
              </>
            ) : openPanel === 'share' ? (
              <>
                <h2 id="share-panel-title">表示内容を共有</h2>
                <p>共有する項目を選べます。緯度・経度、GPS精度、医療機関名は共有しません。</p>
                <div className="share-options">
                  {([
                    ['place', '現在地名'],
                    ['checkedAt', '確認時刻'],
                    ['weather', '天気'],
                    ['solar', '日の出・日の入り'],
                    ['tide', '潮の目安'],
                    ['government', '管轄の役所']
                  ] as Array<[keyof ShareSelection, string]>).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={shareSelection[key]}
                        disabled={!shareContent[key]}
                        onChange={(event) => updateShareSelection(key, event.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="share-preview-label" htmlFor="share-preview">共有プレビュー</label>
                <textarea id="share-preview" className="share-preview" readOnly value={shareText} rows={9} />
                {shareFallback === 'manual' && (
                  <p className="danger-line">自動コピーできませんでした。上の文章を長押ししてコピーしてください。</p>
                )}
                <div className="modal-actions">
                  <button type="button" className="secondary-button compact-button" onClick={() => setOpenPanel(null)}>キャンセル</button>
                  <button type="button" className="secondary-button compact-button" onClick={() => void copyShareText()}>コピー</button>
                  <button type="button" className="primary-button compact-button" onClick={() => void performShare()}>共有する</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="delete-panel-title">保存データを消去</h2>
                <p>この端末に保存した最新位置、表示データ、設定をすべて消去します。元に戻すことはできません。</p>
                {clearStatus === 'error' && <p className="danger-line">消去できませんでした。もう一度お試しください。</p>}
                <div className="modal-actions">
                  <button type="button" className="secondary-button compact-button" disabled={clearStatus === 'loading'} onClick={() => setOpenPanel(null)}>キャンセル</button>
                  <button type="button" className="danger-button" disabled={clearStatus === 'loading'} onClick={() => void clearSavedData()}>
                    {clearStatus === 'loading' ? '消去中…' : '消去する'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {showInstallGuidance && (
        <div className="modal-backdrop install-guidance-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && installActionState !== 'loading') dismissInstallGuidance()
        }}>
          <section
            className="modal-panel install-guidance-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-guidance-title"
            aria-describedby="install-guidance-description"
          >
            <p className="install-guidance-kicker">いまここインフォ</p>
            {installState === 'ios' ? (
              <>
                <h2 id="install-guidance-title">いまここインフォをホーム画面に追加</h2>
                <div className="install-guidance-step" id="install-guidance-description">
                  <span className="install-guidance-icon" aria-hidden="true"><AppIcon name="share" /></span>
                  <p>iPhone・iPadではSafariで共有を開き、「ホーム画面に追加」を選んでください。</p>
                </div>
                <p className="install-guidance-note">ホーム画面から、いまここインフォをすぐ開けるようになります。</p>
                <button
                  type="button"
                  className="primary-button modal-close install-guidance-primary"
                  autoFocus
                  onClick={dismissInstallGuidance}
                >
                  わかりました
                </button>
              </>
            ) : (
              <>
                <h2 id="install-guidance-title">いまここインフォをインストール</h2>
                <div className="install-guidance-step" id="install-guidance-description">
                  <span className="install-guidance-icon" aria-hidden="true"><AppIcon name="pin" /></span>
                  <p>ホーム画面やアプリ一覧から、いまここインフォをすぐ開けるようにします。</p>
                </div>
                <p className="install-guidance-note">インストール後も、位置情報や表示データはこの端末だけに保存されます。</p>
                <div className="modal-actions install-guidance-actions">
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={installActionState === 'loading'}
                    onClick={dismissInstallGuidance}
                  >
                    今はしない
                  </button>
                  <button
                    type="button"
                    className="primary-button compact-button"
                    autoFocus
                    disabled={installActionState === 'loading'}
                    onClick={() => void requestInstall()}
                  >
                    {installActionState === 'loading' ? '確認中…' : 'インストール'}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status" onAnimationEnd={() => setToast(undefined)}>{toast}</div>}
    </div>
  )
}
