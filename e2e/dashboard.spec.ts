import { expect, test } from '@playwright/test'

test.use({
  permissions: ['geolocation'],
  geolocation: { latitude: 35.681236, longitude: 139.767125 }
})

test('初回説明からGPS・地名・天気を順次表示する', async ({ page }) => {
  await page.route('https://marine-api.open-meteo.com/**', async (route) => {
    const start = Date.parse('2026-08-11T00:00:00.000Z') / 1_000
    const time = Array.from({ length: 37 }, (_, index) => start + index * 3_600)
    await route.fulfill({
      json: {
        latitude: 35.64,
        longitude: 139.79,
        timezone: 'Asia/Tokyo',
        hourly: {
          time,
          sea_level_height_msl: time.map((_, index) => Number(Math.cos(index * Math.PI / 6).toFixed(4)))
        },
        hourly_units: { time: 'unixtime', sea_level_height_msl: 'm' }
      }
    })
  })
  await page.route('https://mreversegeocoder.gsi.go.jp/**', async (route) => {
    await route.fulfill({ json: { results: { muniCd: '13101', lv01Nm: '丸の内一丁目' } } })
  })
  await page.route('https://api.open-meteo.com/**', async (route) => {
    await route.fulfill({
      json: {
        latitude: 35.68,
        longitude: 139.77,
        elevation: 16,
        utc_offset_seconds: 32_400,
        timezone: 'Asia/Tokyo',
        current: { time: 1_786_420_800, temperature_2m: 24.5, apparent_temperature: 27.5, weather_code: 61 },
        current_units: { time: 'unixtime', temperature_2m: '°C', apparent_temperature: '°C', weather_code: 'wmo code' },
        hourly: {
          time: [1_786_419_600, 1_786_423_200, 1_786_426_800, 1_786_430_400, 1_786_434_000, 1_786_437_600, 1_786_441_200],
          temperature_2m: [23, 25, 26, 27, 26, 24, 23],
          precipitation_probability: [10, 20, 30, 40, 30, 20, 10],
          weather_code: [1, 2, 2, 3, 61, 61, 2]
        },
        hourly_units: { time: 'unixtime', temperature_2m: '°C', precipitation_probability: '%', weather_code: 'wmo code' },
        daily: {
          time: [1_786_374_000, 1_786_460_400],
          temperature_2m_max: [27, 28],
          temperature_2m_min: [19, 20],
          precipitation_probability_max: [40, 50],
          sunrise: [1_786_391_797, 1_786_478_244],
          sunset: [1_786_440_957, 1_786_527_292]
        },
        daily_units: { time: 'unixtime', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%', sunrise: 'unixtime', sunset: 'unixtime' }
      }
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '現在地から、いま必要な情報をまとめます' })).toBeVisible()
  await page.getByRole('button', { name: '現在地で表示' }).click()

  await expect(page.getByText('東京都千代田区 丸の内一丁目')).toBeVisible()
  await expect(page.getByText('標高 約16m（概算）')).toBeVisible()
  await expect(page.getByText('24.5℃')).toBeVisible()
  await expect(page.getByText('雨')).toBeVisible()
  await expect(page.getByText('干潮の目安')).toBeVisible()
  await expect(page.getByText('航海・防災には使用不可')).toBeVisible()
  await expect(page.getByText('東京駅', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('東京都庁', { exact: true })).toBeVisible()
  await expect(page.getByText('千代田区役所', { exact: true })).toBeVisible()
  await expect(page.getByText('病院　3件', { exact: true })).toBeVisible()
  await expect(page.getByText('一般診療所　3件', { exact: true })).toBeVisible()
  await expect(page.getByText('緊急時は119', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存データを消去' }).click()
  await expect(page.getByRole('dialog', { name: '保存データを消去' })).toBeVisible()
  await page.getByRole('button', { name: '消去する' }).click()
  await expect(page.getByRole('heading', { name: '現在地から、いま必要な情報をまとめます' })).toBeVisible()
  await expect(page.getByText('保存データを消去しました')).toBeVisible()

  const savedCounts = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('imakoko-info')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction(['latest-location', 'latest-dashboard', 'resource-cache'], 'readonly')
    const count = (store: string) => new Promise<number>((resolve, reject) => {
      const request = transaction.objectStore(store).count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const [location, dashboard, resources] = await Promise.all([
      count('latest-location'),
      count('latest-dashboard'),
      count('resource-cache')
    ])
    return {
      location,
      dashboard,
      resources,
      settings: localStorage.getItem('imakoko-info:settings')
    }
  })
  expect(savedCounts).toEqual({ location: 0, dashboard: 0, resources: 0, settings: null })
})

test('モバイル画面が指定の順序と日時装飾で表示される', async ({ page }) => {
  await page.goto('/?preview=1')

  await expect(page.getByRole('heading', { level: 1, name: 'いまここインフォ' })).toBeVisible()
  await expect(page.getByText('© 2026 SIKUMI LAB')).toBeVisible()
  await expect(page.getByText('標高 約10m（概算）')).toBeVisible()

  const cardIds = await page.locator('[data-card-id]').evaluateAll((cards) =>
    cards.map((card) => card.getAttribute('data-card-id'))
  )
  expect(cardIds).toEqual([
    'location',
    'weather',
    'solar',
    'tide',
    'station',
    'government',
    'medical'
  ])

  const dateStyle = await page.locator('.current-date').evaluate((element) => {
    const style = getComputedStyle(element)
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight }
  })
  const clockStyle = await page.locator('.current-clock').evaluate((element) => {
    const style = getComputedStyle(element)
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight }
  })

  expect(dateStyle).toEqual(clockStyle)
  expect(dateStyle.fontFamily).toContain('Kosugi')

  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true })
})

test('補足情報を横一列に整理して現在地カードをコンパクトに表示する', async ({ page }) => {
  await page.goto('/?preview=1')

  const sameRow = async (leftText: string, rightText: string) => {
    const left = await page.getByText(leftText, { exact: true }).boundingBox()
    const right = await page.getByText(rightText, { exact: true }).boundingBox()

    expect(left).not.toBeNull()
    expect(right).not.toBeNull()
    expect(Math.abs(left!.y - right!.y)).toBeLessThan(6)
  }

  const locationCard = await page.locator('[data-card-id="location"]').boundingBox()
  const locationHeading = await page.getByRole('heading', { level: 2, name: 'いまここ' }).boundingBox()
  const acquiredAt = await page.getByText('取得 14:31', { exact: true }).boundingBox()

  expect(locationCard).not.toBeNull()
  expect(locationHeading).not.toBeNull()
  expect(acquiredAt).not.toBeNull()
  expect(acquiredAt!.y).toBeLessThan(locationHeading!.y + locationHeading!.height)
  expect(acquiredAt!.y + acquiredAt!.height).toBeGreaterThan(locationHeading!.y)
  expect(acquiredAt!.x).toBeGreaterThan(locationCard!.x + locationCard!.width / 2)

  const locationName = await page.getByText('東京都千代田区 丸の内一丁目', { exact: true }).boundingBox()
  expect(locationName).not.toBeNull()
  expect(locationName!.height).toBeLessThan(32)

  await sameRow('精度の目安 ±18m', '標高 約10m（概算）')
  await sameRow('約12km先の海洋モデル', '航海・防災には使用不可')
  await sameRow('ほかの駅を見る', '直線距離・所要時間ではありません')
  await sameRow('その他の医療機関を確認中…', '緊急時は119')

  const stationCard = await page.locator('[data-card-id="station"]').boundingBox()
  const stationNotice = await page.getByText('直線距離・所要時間ではありません', { exact: true }).boundingBox()
  expect(stationCard).not.toBeNull()
  expect(stationNotice).not.toBeNull()
  expect(stationNotice!.x + stationNotice!.width).toBeLessThan(stationCard!.x + stationCard!.width - 12)
})

test('測位できない再訪時は24時間以内の前回位置を明示して復元する', async ({ page, context }) => {
  await page.goto('/')

  await page.evaluate(async () => {
    const now = new Date()
    const acquiredAt = now.toISOString()
    const freshUntil = new Date(now.getTime() + 15 * 60_000).toISOString()
    const staleUntil = new Date(now.getTime() + 24 * 60 * 60_000).toISOString()

    localStorage.setItem('imakoko-info:settings', JSON.stringify({
      schemaVersion: 1,
      onboardingAccepted: true,
      expandedCards: [],
      theme: 'system',
      lastSeenAppVersion: '0.1.0'
    }))

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('imakoko-info', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('latest-location')) db.createObjectStore('latest-location')
        if (!db.objectStoreNames.contains('latest-dashboard')) db.createObjectStore('latest-dashboard')
        if (!db.objectStoreNames.contains('resource-cache')) db.createObjectStore('resource-cache', { keyPath: 'resourceType' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['latest-location', 'resource-cache'], 'readwrite')
      transaction.objectStore('latest-location').put({
        schemaVersion: 1,
        coordinates: { latitude: 35.6812, longitude: 139.7671 },
        accuracyMeters: 25,
        acquiredAt,
        expiresAt: staleUntil
      }, 'latest')
      transaction.objectStore('resource-cache').put({
        resourceType: 'place',
        origin: { latitude: 35.6812, longitude: 139.7671 },
        payload: {
          municipalityCode: '13101',
          prefectureName: '東京都',
          municipalityName: '千代田区',
          localityName: '丸の内一丁目',
          displayName: '東京都千代田区 丸の内一丁目',
          boundaryCaution: false,
          providerFetchedAt: acquiredAt
        },
        fetchedAt: acquiredAt,
        freshUntil,
        staleUntil,
        provider: 'gsi-reverse-geocoder'
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    database.close()
  })

  await context.clearPermissions()
  await page.route('https://api.open-meteo.com/**', (route) => route.abort())
  await page.route('https://marine-api.open-meteo.com/**', (route) => route.abort())
  await page.reload()

  await expect(page.getByText('東京都千代田区 丸の内一丁目')).toBeVisible()
  await expect(page.getByText('前回の位置', { exact: true })).toBeVisible()
  await expect(page.getByText('現在地を取得できないため、24時間以内の前回位置を表示しています')).toBeVisible()
})

test('主要4幅・文字200%・ダーク・動き軽減でも主画面を操作できる', async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/?preview=1')
    await expect(page.getByRole('heading', { level: 1, name: 'いまここインフォ' })).toBeVisible()
    await expect(page.locator('[data-card-id="medical"]')).toBeAttached()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  }

  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('/?preview=1')
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect(page.getByRole('heading', { level: 1, name: 'いまここインフォ' })).toBeVisible()
  await expect(page.getByRole('button', { name: '出典・プライバシー' })).toBeAttached()
  const zoomedLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    metrics: {
      html: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      body: [document.body.clientWidth, document.body.scrollWidth],
      root: [document.getElementById('root')!.clientWidth, document.getElementById('root')!.scrollWidth],
      shell: [document.querySelector<HTMLElement>('.app-shell')!.clientWidth, document.querySelector<HTMLElement>('.app-shell')!.scrollWidth]
    },
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        text: element.textContent?.trim().slice(0, 80),
        right: Math.round(element.getBoundingClientRect().right)
      }))
  }))
  expect(zoomedLayout.overflow, JSON.stringify(zoomedLayout)).toBeLessThanOrEqual(1)

  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.reload()
  const mediaStyles = await page.locator('.app-shell').evaluate((element) => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    animationDuration: getComputedStyle(document.querySelector('.loading-bars i')!).animationDuration
  }))
  expect(mediaStyles.backgroundImage).toContain('linear-gradient')
  expect(['0.01ms', '1e-05s']).toContain(mediaStyles.animationDuration)

  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toBeVisible()
})
