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

  it('旧形式ではインストール案内を未確認として補完する', () => {
    localStorage.setItem('imakoko-info:settings', JSON.stringify({
      schemaVersion: 1,
      onboardingAccepted: true,
      expandedCards: [],
      theme: 'system',
      lastSeenAppVersion: '0.1.0'
    }))

    expect(readAppSettings().installPromptSeen).toBe(false)
  })

  it('インストール案内の表示済み状態を保存し全消去で解除する', () => {
    updateAppSettings({ installPromptSeen: true })
    expect(readAppSettings().installPromptSeen).toBe(true)

    clearAppSettings()
    expect(readAppSettings().installPromptSeen).toBe(false)
  })
})
