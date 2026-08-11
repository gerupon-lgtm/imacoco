import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

const fixedNow = new Date('2026-08-11T05:32:00.000Z')

describe('現在地ダッシュボード', () => {
  it('ブランド、JST日時、概算標高を利用者向け文言で表示する', () => {
    render(<App initialNow={fixedNow} />)

    expect(screen.getByRole('heading', { level: 1, name: 'いまここインフォ' })).toBeVisible()
    expect(screen.getByText('© 2026 SIKUMI LAB')).toBeVisible()
    expect(screen.getByText('2026年8月11日（火）')).toBeVisible()
    expect(screen.getByText('14:32', { selector: '.current-clock' })).toBeVisible()
    expect(screen.getByText('標高 約10m（概算）')).toBeVisible()
  })

  it('潮の目安より後を最寄り駅、役所、医療機関の順に並べる', () => {
    render(<App initialNow={fixedNow} />)

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
})
