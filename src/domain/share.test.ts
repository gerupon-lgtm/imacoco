import { describe, expect, it } from 'vitest'

import { buildShareText, defaultShareSelection } from './share'

const content = {
  place: '東京都千代田区 丸の内一丁目',
  checkedAt: '2026年8月11日 14:31',
  weather: '晴れ時々くもり 24.6℃',
  solar: '日の出 5:02／日の入り 18:27',
  tide: '満潮の目安 20:14／干潮の目安 15:18',
  government: '管轄の役所 千代田区役所'
}

describe('safe share text', () => {
  it('選択した表示情報と通常の入口URLだけを共有する', () => {
    const text = buildShareText(content, defaultShareSelection, 'https://example.com/')

    expect(text).toContain('東京都千代田区 丸の内一丁目')
    expect(text).toContain('晴れ時々くもり 24.6℃')
    expect(text).toContain('https://example.com/')
    expect(text).not.toMatch(/[?&](lat|lon|lng|accuracy)=/i)
    expect(text).not.toContain('35.681236')
    expect(text).not.toContain('139.767125')
    expect(text).not.toContain('医療')
  })

  it('選択を外した項目は本文に含めない', () => {
    const text = buildShareText(content, { ...defaultShareSelection, tide: false, government: false })

    expect(text).not.toContain('満潮')
    expect(text).not.toContain('千代田区役所')
  })
})
