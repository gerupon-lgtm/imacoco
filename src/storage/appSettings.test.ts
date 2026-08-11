import { beforeEach, describe, expect, it } from 'vitest'

import { clearAppSettings, readAppSettings, updateAppSettings } from './appSettings'

describe('app settings', () => {
  beforeEach(() => localStorage.clear())

  it('未保存・破損・未知形式は位置を含まない既定値へ戻す', () => {
    expect(readAppSettings()).toMatchObject({ onboardingAccepted: false, theme: 'system' })
    localStorage.setItem('imakoko-info:settings', '{broken')
    expect(readAppSettings()).toMatchObject({ onboardingAccepted: false, expandedCards: [] })
  })

  it('設定更新と冪等な全消去ができる', () => {
    updateAppSettings({ onboardingAccepted: true, expandedCards: ['weather'] })
    expect(readAppSettings()).toMatchObject({ onboardingAccepted: true, expandedCards: ['weather'] })

    clearAppSettings()
    clearAppSettings()
    expect(readAppSettings().onboardingAccepted).toBe(false)
  })
})
