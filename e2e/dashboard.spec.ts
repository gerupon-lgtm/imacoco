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
  await expect(page.getByLabel('現在気温 24.5℃')).toBeVisible()
  await expect(page.getByText('雨')).toBeVisible()
  await expect(page.getByText('干潮の目安')).toBeVisible()
  await expect(page.getByText('航海・防災には使用不可です')).toBeVisible()
  await expect(page.getByText('東京駅', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('東京都庁', { exact: true })).toBeVisible()
  await expect(page.getByText('千代田区役所', { exact: true })).toBeVisible()
  await expect(page.getByText('病院　3件', { exact: true })).toBeVisible()
  await expect(page.getByText('一般診療所　3件', { exact: true })).toBeVisible()
  await expect(page.getByText('緊急時は119', { exact: true })).toBeVisible()
  await expect(page.getByText('半径10km・受診前に公式情報を確認して下さい', { exact: true })).toBeVisible()

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

test('表示色モードをライト・ダーク・自動から選んで保存できる', async ({ page }) => {
  await page.goto('/?preview=1')

  const themeSelect = page.getByRole('combobox', { name: '表示色モード' })
  await expect(themeSelect).toHaveValue('system')

  await themeSelect.selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const darkHeaderControlBorders = await page.evaluate(() => [
    getComputedStyle(document.querySelector('.header-button')!).borderColor,
    getComputedStyle(document.querySelector('.theme-picker select')!).borderColor
  ])
  expect(new Set(darkHeaderControlBorders).size).toBe(1)
  await page.reload()
  await expect(themeSelect).toHaveValue('dark')
  await page.screenshot({ path: 'test-results/dashboard-mobile-refined-dark.png', fullPage: true })

  await themeSelect.selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await themeSelect.selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system')
})

test('正式アイコンと控えめな文字サイズで現在地への地図導線を表示する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?preview=1')

  const brandIcon = page.locator('.brand-icon')
  await expect(brandIcon).toHaveAttribute('src', /favicon\.svg$/)
  await expect(page.getByText('imacoco-info', { exact: true })).toBeVisible()
  await expect(page.getByText('表示距離はすべて現在地からの直線距離です', { exact: true })).toHaveCount(1)
  await expect(page.getByText('地図で開く', { exact: true })).toHaveCount(2)
  await expect(page.locator('.updated-at')).toHaveCount(0)
  await expect(page.getByRole('link', { name: '現在地を地図で開く' })).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=35.681236,139.767125'
  )

  const metrics = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect()
    const fontSize = (selector: string) => Number.parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize)
    const icon = rect('.brand-icon')
    const title = rect('.brand-block h1')
    const titleStyle = getComputedStyle(document.querySelector('.brand-block h1')!)
    const addressStyle = getComputedStyle(document.querySelector('.location-name')!)
    const weatherIcon = rect('.weather-state-icon')
    const weatherCopy = rect('.weather-current-copy')
    const locationMapStyle = getComputedStyle(document.querySelector('.location-map-link')!)
    const stationMapStyle = getComputedStyle(document.querySelector('[data-card-id="station"] .primary-button')!)
    const locationMapRect = rect('.location-map-link')
    const stationMapRect = rect('[data-card-id="station"] .primary-button')
    const headerActions = rect('.header-actions')
    const themePicker = rect('.theme-picker')
    const headerControlBorders = [
      getComputedStyle(document.querySelector('.header-button')!).borderColor,
      getComputedStyle(document.querySelector('.theme-picker select')!).borderColor
    ]
    const cardContentGaps = ['weather', 'solar', 'tide', 'medical'].map((id) => {
      const heading = rect(`[data-card-id="${id}"] .card-heading`)
      const body = rect(`[data-card-id="${id}"] .card-body`)
      return body.top - heading.bottom
    })
    return {
      headerTopDifference: Math.abs(icon.top - title.top),
      headerButtonHeight: rect('.header-button').height,
      themeControlWidthDifference: Math.abs(headerActions.width - themePicker.width),
      themeControlGap: themePicker.top - headerActions.bottom,
      headerControlBorders,
      slugLetterSpacing: Number.parseFloat(getComputedStyle(document.querySelector('.brand-slug')!).letterSpacing),
      titleFontSize: fontSize('.brand-block h1'),
      titleHeight: title.height,
      titleLineHeight: Number.parseFloat(titleStyle.lineHeight),
      titleWhiteSpace: titleStyle.whiteSpace,
      titleFontWeight: Number.parseInt(titleStyle.fontWeight, 10),
      cardTitleFontSizes: [...document.querySelectorAll<HTMLElement>('.card-heading h2')].map((heading) => Number.parseFloat(getComputedStyle(heading).fontSize)),
      cardTitleLetterSpacings: [...document.querySelectorAll<HTMLElement>('.card-heading h2')].map((heading) => getComputedStyle(heading).letterSpacing),
      mapButtonBackgrounds: [locationMapStyle.backgroundColor, stationMapStyle.backgroundColor],
      mapButtonColors: [locationMapStyle.color, stationMapStyle.color],
      mapButtonHeightDifference: Math.abs(locationMapRect.height - stationMapRect.height),
      mapButtonFontSizes: [Number.parseFloat(locationMapStyle.fontSize), Number.parseFloat(stationMapStyle.fontSize)],
      mapButtonIconWidths: [rect('.location-map-link .app-icon').width, rect('[data-card-id="station"] .primary-button .app-icon').width],
      addressFontSize: fontSize('.location-name'),
      addressLineHeight: Number.parseFloat(addressStyle.lineHeight),
      locationHeadingFontSize: fontSize('.location-card .card-heading h2'),
      weatherIconWidth: weatherIcon.width,
      temperatureFontSize: fontSize('.weather-main strong'),
      weatherTopDifference: Math.abs(rect('.weather-state-icon').top - rect('.weather-main strong').top),
      weatherCopyHeightDifference: Math.abs(weatherIcon.height - weatherCopy.height),
      temperatureUnitWeight: Number.parseInt(getComputedStyle(document.querySelector('.temperature-unit')!).fontWeight, 10),
      cardContentGaps,
      shellBackground: getComputedStyle(document.querySelector('.app-shell')!).backgroundImage,
      fontSynthesis: getComputedStyle(document.documentElement).fontSynthesis
    }
  })

  expect(metrics.headerTopDifference).toBeLessThanOrEqual(1)
  expect(metrics.headerButtonHeight).toBeLessThanOrEqual(44)
  expect(metrics.slugLetterSpacing).toBeGreaterThanOrEqual(2)
  expect(metrics.titleFontSize).toBeLessThanOrEqual(24)
  expect(metrics.titleFontSize).toBeGreaterThanOrEqual(20)
  expect(metrics.themeControlWidthDifference).toBeLessThanOrEqual(1)
  expect(metrics.themeControlGap).toBeLessThanOrEqual(4)
  expect(new Set(metrics.headerControlBorders).size).toBe(1)
  expect(metrics.titleHeight).toBeLessThanOrEqual(metrics.titleLineHeight * 1.1)
  expect(metrics.titleWhiteSpace).toBe('nowrap')
  expect(metrics.titleFontWeight).toBeGreaterThanOrEqual(700)
  expect(new Set(metrics.cardTitleFontSizes).size).toBe(1)
  expect(new Set(metrics.cardTitleLetterSpacings).size).toBe(1)
  expect(new Set(metrics.mapButtonBackgrounds).size).toBe(1)
  expect(new Set(metrics.mapButtonColors).size).toBe(1)
  expect(metrics.mapButtonHeightDifference).toBeLessThanOrEqual(1)
  expect(new Set(metrics.mapButtonFontSizes).size).toBe(1)
  expect(new Set(metrics.mapButtonIconWidths).size).toBe(1)
  expect(metrics.addressFontSize).toBeGreaterThanOrEqual(16.5)
  expect(metrics.addressFontSize).toBeGreaterThan(metrics.locationHeadingFontSize)
  expect(metrics.addressLineHeight / metrics.addressFontSize).toBeGreaterThanOrEqual(1.4)
  expect(metrics.weatherIconWidth).toBeLessThanOrEqual(60)
  expect(metrics.temperatureFontSize).toBeLessThanOrEqual(40)
  expect(metrics.weatherTopDifference).toBeLessThanOrEqual(1)
  expect(metrics.weatherCopyHeightDifference).toBeLessThanOrEqual(1)
  expect(metrics.temperatureUnitWeight).toBe(400)
  expect(Math.max(...metrics.cardContentGaps), JSON.stringify(metrics.cardContentGaps)).toBeLessThanOrEqual(4)
  expect(metrics.shellBackground).toContain('rgb(215, 229, 233)')
  expect(metrics.fontSynthesis).toBe('none')
  await page.screenshot({ path: 'test-results/dashboard-mobile-refined-light.png', fullPage: true })
})

test('補足情報を横一列に整理して現在地カードをコンパクトに表示する', async ({ page }) => {
  await page.goto('/?preview=1')

  const sameRow = async (leftText: string, rightText: string) => {
    const left = await page.getByText(leftText, { exact: true }).first().boundingBox()
    const right = await page.getByText(rightText, { exact: true }).first().boundingBox()

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
  expect(locationName!.height).toBeLessThan(56)

  await sameRow('精度の目安 ±18m', '標高 約10m（概算）')
  await sameRow('約12km先の海洋モデル', '航海・防災には使用不可です')
  await sameRow('その他の医療機関を確認中…', '緊急時は119')

  const medicalCard = await page.locator('[data-card-id="medical"]').boundingBox()
  const distanceNotice = await page.getByText('表示距離はすべて現在地からの直線距離です', { exact: true }).boundingBox()
  expect(medicalCard).not.toBeNull()
  expect(distanceNotice).not.toBeNull()
  expect(distanceNotice!.y).toBeGreaterThanOrEqual(medicalCard!.y + medicalCard!.height)
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
  const footerStatus = page.locator('.footer-meta')
  await expect(footerStatus.getByText('一部に15分以内の保存済み情報を表示しています', { exact: true })).toHaveCount(1)
  await expect(footerStatus).toContainText('mvp-0.1.0')
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
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      offenders: [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1 || element.scrollWidth > element.clientWidth + 1)
        .slice(0, 8)
        .map((element) => ({ className: element.className, text: element.textContent?.trim().slice(0, 50), right: Math.round(element.getBoundingClientRect().right), width: [element.clientWidth, element.scrollWidth] }))
    }))
    expect(layout.overflow, `${viewport.width}px ${JSON.stringify(layout.offenders)}`).toBeLessThanOrEqual(1)
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

test('ダークモードで主要カードのアイコンと操作文字を判読できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/?preview=1')
  await page.evaluate(() => {
    const fixture = document.createElement('section')
    fixture.className = 'info-card contrast-test-fixture'
    fixture.innerHTML = `
      <div class="government-office"><div><strong>千代田区役所</strong></div></div>
      <div class="medical-facility"><div><strong>テスト医院</strong></div><span class="medical-actions"><a href="#">地図</a></span></div>
      <p class="medical-source-link"><a href="#">医療情報ネットで確認</a></p>
    `
    document.body.append(fixture)
  })

  const contrastRatios = await page.evaluate(() => {
    type Rgb = { r: number; g: number; b: number; a: number }

    const parseColor = (value: string): Rgb => {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? []
      return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
    }
    const composite = (foreground: Rgb, background: Rgb): Rgb => ({
      r: foreground.r * foreground.a + background.r * (1 - foreground.a),
      g: foreground.g * foreground.a + background.g * (1 - foreground.a),
      b: foreground.b * foreground.a + background.b * (1 - foreground.a),
      a: 1
    })
    const paintedBackground = (element: Element): Rgb => {
      const layers: Rgb[] = []
      for (let current: Element | null = element; current; current = current.parentElement) {
        const color = parseColor(getComputedStyle(current).backgroundColor)
        if (color.a > 0) layers.push(color)
      }
      return layers.reverse().reduce((background, foreground) => composite(foreground, background), {
        r: 7,
        g: 26,
        b: 42,
        a: 1
      })
    }
    const luminance = (color: Rgb) => {
      const channels = [color.r, color.g, color.b].map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ratio = (foreground: Rgb, background: Rgb) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      return (lighter + 0.05) / (darker + 0.05)
    }
    const contrastFor = (selector: string) => {
      const element = document.querySelector(selector)
      if (!element) throw new Error(`Missing contrast target: ${selector}`)
      return ratio(parseColor(getComputedStyle(element).color), paintedBackground(element))
    }

    return {
      headerRefreshIcon: contrastFor('.header-button .header-action-icon'),
      tideIcon: contrastFor('[data-card-id="tide"] .card-icon'),
      stationIcon: contrastFor('[data-card-id="station"] .card-icon'),
      governmentIcon: contrastFor('[data-card-id="government"] .card-icon'),
      medicalIcon: contrastFor('[data-card-id="medical"] .card-icon'),
      tideBadge: contrastFor('[data-card-id="tide"] .badge'),
      stationMap: contrastFor('[data-card-id="station"] .primary-button'),
      governmentName: contrastFor('.contrast-test-fixture .government-office strong'),
      medicalMap: contrastFor('.contrast-test-fixture .medical-actions a:last-child'),
      medicalSource: contrastFor('.contrast-test-fixture .medical-source-link a')
    }
  })

  for (const [target, ratio] of Object.entries(contrastRatios)) {
    expect.soft(ratio, `${target}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  }

  await page.locator('.contrast-test-fixture').evaluate((element) => element.remove())
  await page.screenshot({ path: 'test-results/dashboard-mobile-dark.png', fullPage: true })
})

test('天気の気温補足値を一列に揃え、MVP版を表示する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?preview=1')
  await page.evaluate(() => document.fonts.ready)

  const temperatureValueTops = await page.locator('.weather-details dd').evaluateAll((values) =>
    values.slice(0, 3).map((value) => Math.round(value.getBoundingClientRect().top))
  )

  expect(temperatureValueTops).toHaveLength(3)
  expect.soft(
    Math.max(...temperatureValueTops) - Math.min(...temperatureValueTops),
    `weather temperature value tops: ${JSON.stringify(temperatureValueTops)}`
  ).toBeLessThanOrEqual(1)
  await expect.soft(page.locator('.app-footer')).toContainText('mvp-0.1.0')
})
