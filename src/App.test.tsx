import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import type { InstallExperience, InstallExperienceState } from './pwa/installExperience'
import { GeolocationProviderError } from './providers/geolocation'
import { PlaceProviderError } from './providers/gsiReverseGeocoder'
import { readAppSettings, updateAppSettings } from './storage/appSettings'

const fixedNow = new Date('2026-08-11T05:32:00.000Z')

const locationFix = {
  latitude: 35.681236,
  longitude: 139.767125,
  accuracyMeters: 18,
  capturedAt: '2026-08-11T05:31:00.000Z'
}

const placeSummary = {
  municipalityCode: '13101',
  prefectureName: '東京都',
  municipalityName: '千代田区',
  localityName: '丸の内一丁目',
  displayName: '東京都千代田区 丸の内一丁目',
  boundaryCaution: false,
  providerFetchedAt: '2026-08-11T05:31:05.000Z'
}

const weatherSummary = {
  weather: {
    weatherCode: 2,
    weatherLabel: '晴れ時々くもり',
    temperatureC: 24.6,
    apparentTemperatureC: 25.1,
    todayMaxC: 27,
    todayMinC: 19,
    precipitationProbabilityMax: 20,
    elevationMeters: 10,
    nextSixHours: [],
    modelCoordinates: { latitude: 35.68, longitude: 139.77 },
    fetchedAt: '2026-08-11T05:31:06.000Z'
  },
  solar: {
    localDate: '2026-08-11',
    sunriseAt: '2026-08-10T20:02:00.000Z',
    sunsetAt: '2026-08-11T09:27:00.000Z',
    fetchedAt: '2026-08-11T05:31:06.000Z'
  }
}

function fakeInstallExperience(initialState: InstallExperienceState) {
  let state = initialState
  const listeners = new Set<() => void>()
  const install = vi.fn(async () => 'accepted' as const)
  const experience: InstallExperience & { setState(next: InstallExperienceState): void } = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    install,
    destroy: vi.fn(),
    setState(next) {
      state = next
      listeners.forEach((listener) => listener())
    }
  }
  return experience
}

describe('現在地ダッシュボード', () => {
  beforeEach(() => localStorage.clear())

  it('ブランド、JST日時、概算標高を利用者向け文言で表示する', () => {
    render(<App initialNow={fixedNow} initialMode="preview" />)

    expect(screen.getByRole('heading', { level: 1, name: 'いまここインフォ' })).toBeVisible()
    expect(screen.getByText('© 2026 SIKUMI LAB')).toBeVisible()
    expect(screen.getByText('2026年8月11日（火）')).toBeVisible()
    expect(screen.getByText('14:32', { selector: '.current-clock' })).toBeVisible()
    expect(screen.getByText('標高 約10m（概算）')).toBeVisible()
  })

  it('潮の目安より後を最寄り駅、役所、医療機関の順に並べる', () => {
    render(<App initialNow={fixedNow} initialMode="preview" />)

    const cardHeadings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent)

    expect(cardHeadings).toEqual([
      'いまここ',
      '天気',
      '太陽',
      '潮の目安',
      '最寄り駅',
      '役所',
      '医療機関'
    ])
  })

  it('初回説明の明示操作後にだけ位置情報を要求して測位結果を表示する', async () => {
    const user = userEvent.setup()
    const getCurrentLocation = vi.fn().mockResolvedValue({
      latitude: 35.681236,
      longitude: 139.767125,
      accuracyMeters: 18,
      capturedAt: '2026-08-11T05:31:00.000Z'
    })

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        geolocationProvider={{ getCurrentLocation }}
      />
    )

    expect(screen.getByRole('heading', { name: '現在地から、いま必要な情報をまとめます' })).toBeVisible()
    expect(getCurrentLocation).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '現在地で表示' }))

    expect(getCurrentLocation).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('精度の目安 ±18m')).toBeVisible()
    expect(screen.getByText('取得 14:31')).toBeVisible()
  })

  it('位置情報を使わない選択では許可を求めず、後から再開できる', async () => {
    const user = userEvent.setup()
    const getCurrentLocation = vi.fn()

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        geolocationProvider={{ getCurrentLocation }}
      />
    )

    await user.click(screen.getByRole('button', { name: '今は使わない' }))

    expect(getCurrentLocation).not.toHaveBeenCalled()
    expect(screen.getByText('現在地を取得していません')).toBeVisible()
    expect(screen.getByRole('button', { name: '現在地を確認する' })).toBeVisible()
  })

  it('初回位置説明の完了後にiOS案内を表示して確認済みを保存する', async () => {
    const user = userEvent.setup()
    const installExperience = fakeInstallExperience('ios')

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        installExperience={installExperience}
      />
    )

    expect(screen.queryByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '今は使わない' }))

    const dialog = screen.getByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })
    expect(dialog).toBeVisible()
    expect(screen.getByText(/Safariで共有を開き/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'わかりました' }))

    expect(dialog).not.toBeInTheDocument()
    expect(readAppSettings().installPromptSeen).toBe(true)
  })

  it('Android・PCのインストール操作をブラウザアダプターへ渡す', async () => {
    const user = userEvent.setup()
    const installExperience = fakeInstallExperience('installable')

    render(
      <App
        initialNow={fixedNow}
        initialMode="idle"
        installExperience={installExperience}
      />
    )

    expect(screen.getByRole('dialog', { name: 'いまここインフォをインストール' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'インストール' }))

    expect(installExperience.install).toHaveBeenCalledOnce()
    expect(readAppSettings().installPromptSeen).toBe(true)
  })

  it('確認済みまたは既存モーダル表示中はインストール案内を重ねない', async () => {
    const user = userEvent.setup()
    updateAppSettings({ installPromptSeen: true })
    const seenExperience = fakeInstallExperience('ios')
    const { unmount } = render(
      <App initialNow={fixedNow} initialMode="idle" installExperience={seenExperience} />
    )
    expect(screen.queryByRole('dialog', { name: /ホーム画面に追加/ })).not.toBeInTheDocument()
    unmount()

    localStorage.clear()
    const waitingExperience = fakeInstallExperience('waiting')
    render(<App initialNow={fixedNow} initialMode="idle" installExperience={waitingExperience} />)
    await user.click(screen.getByRole('button', { name: '出典・プライバシー' }))
    waitingExperience.setState('installable')

    expect(screen.getByRole('dialog', { name: '出典・プライバシー' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: /インストール/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.getByRole('dialog', { name: 'いまここインフォをインストール' })).toBeVisible()
  })

  it('位置情報の拒否理由と再試行を表示する', async () => {
    const user = userEvent.setup()
    const getCurrentLocation = vi
      .fn()
      .mockRejectedValueOnce(new GeolocationProviderError('GEO_PERMISSION_DENIED'))
      .mockResolvedValueOnce({
        latitude: 35.681236,
        longitude: 139.767125,
        accuracyMeters: 18,
        capturedAt: '2026-08-11T05:31:00.000Z'
      })

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        geolocationProvider={{ getCurrentLocation }}
      />
    )

    await user.click(screen.getByRole('button', { name: '現在地で表示' }))
    expect(await screen.findByText('位置情報が許可されていません')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'もう一度試す' }))
    expect(await screen.findByText('精度の目安 ±18m')).toBeVisible()
    expect(getCurrentLocation).toHaveBeenCalledTimes(2)
  })

  it('GPS確定後に地名と天気を並行取得して届いたカードから表示する', async () => {
    const user = userEvent.setup()
    const fetchPlace = vi.fn().mockResolvedValue(placeSummary)
    const fetchWeather = vi.fn().mockResolvedValue(weatherSummary)

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        geolocationProvider={{ getCurrentLocation: vi.fn().mockResolvedValue(locationFix) }}
        placeProvider={{ fetchPlace }}
        weatherProvider={{ fetchWeather }}
      />
    )

    await user.click(screen.getByRole('button', { name: '現在地で表示' }))

    expect(await screen.findByText('東京都千代田区 丸の内一丁目')).toBeVisible()
    expect(screen.getByText('標高 約10m（概算）')).toBeVisible()
    expect(screen.getByLabelText('現在気温 24.6℃')).toBeVisible()
    expect(screen.getByText('晴れ時々くもり')).toBeVisible()
    expect(screen.getByText('5:02')).toBeVisible()
    expect(screen.getByText('18:27')).toBeVisible()
    expect(fetchPlace).toHaveBeenCalledTimes(1)
    expect(fetchWeather).toHaveBeenCalledTimes(1)
  })

  it('地名取得だけが失敗しても天気と標高を維持し個別再試行を示す', async () => {
    const user = userEvent.setup()
    const fetchPlace = vi.fn().mockRejectedValue(new PlaceProviderError('PLACE_NETWORK_ERROR'))

    render(
      <App
        initialNow={fixedNow}
        initialMode="intro"
        geolocationProvider={{ getCurrentLocation: vi.fn().mockResolvedValue(locationFix) }}
        placeProvider={{ fetchPlace }}
        weatherProvider={{ fetchWeather: vi.fn().mockResolvedValue(weatherSummary) }}
      />
    )

    await user.click(screen.getByRole('button', { name: '現在地で表示' }))

    expect(await screen.findByText('地名を取得できませんでした')).toBeVisible()
    expect(screen.getByLabelText('現在気温 24.6℃')).toBeVisible()
    expect(screen.getByText('標高 約10m（概算）')).toBeVisible()
    expect(screen.getByRole('button', { name: '地名を再試行' })).toBeVisible()
    expect(fetchPlace).toHaveBeenCalledTimes(2)
  })

  it('出典・プライバシーに外部送信と概算値の注意を表示する', async () => {
    const user = userEvent.setup()
    render(<App initialNow={fixedNow} initialMode="idle" />)

    await user.click(screen.getByRole('button', { name: '出典・プライバシー' }))

    expect(screen.getByRole('dialog', { name: '出典・プライバシー' })).toBeVisible()
    expect(screen.getByText(/国土地理院/)).toBeVisible()
    expect(screen.getAllByText(/Open-Meteo/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/国土数値情報/)).toBeVisible()
    expect(screen.getByText(/厚生労働省/)).toBeVisible()
    expect(screen.getByText(/アマノ技研/)).toBeVisible()
    expect(screen.getByText(/本アプリのサーバーへ保存せず/)).toBeVisible()
    expect(screen.getByText(/防災・登山・測量/)).toBeVisible()
  })
})
