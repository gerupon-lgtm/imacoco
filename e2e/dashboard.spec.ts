import { expect, test } from '@playwright/test'

test('モバイル画面が指定の順序と日時装飾で表示される', async ({ page }) => {
  await page.goto('/')

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
  await page.goto('/')

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
