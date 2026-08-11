import { describe, expect, it, vi } from 'vitest'

import { createInstallExperience } from './installExperience'

type FakeWindowOptions = {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  standalone?: boolean
  displayModeStandalone?: boolean
}

class FakeWindow extends EventTarget {
  navigator: Navigator
  matchMedia: Window['matchMedia']

  constructor(options: FakeWindowOptions = {}) {
    super()
    this.navigator = {
      userAgent: options.userAgent ?? 'Mozilla/5.0 Windows',
      platform: options.platform ?? 'Win32',
      maxTouchPoints: options.maxTouchPoints ?? 0,
      standalone: options.standalone ?? false
    } as unknown as Navigator
    this.matchMedia = vi.fn().mockReturnValue({
      matches: options.displayModeStandalone ?? false,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  }
}

function createFakeWindow(options?: FakeWindowOptions) {
  return new FakeWindow(options) as unknown as Window
}

function createInstallPromptEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn().mockResolvedValue(undefined)
  Object.assign(event, {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: 'web' })
  })
  return { event, prompt }
}

describe('PWA install experience', () => {
  it('iPhoneブラウザをiosとして開始する', () => {
    const target = createFakeWindow({ userAgent: 'Mozilla/5.0 iPhone', platform: 'iPhone' })
    expect(createInstallExperience(target).getState()).toBe('ios')
  })

  it('タッチ操作のiPadOSをiosとして開始する', () => {
    const target = createFakeWindow({ platform: 'MacIntel', maxTouchPoints: 5 })
    expect(createInstallExperience(target).getState()).toBe('ios')
  })

  it.each([
    { standalone: true },
    { displayModeStandalone: true }
  ])('インストール済みならinstalledとして開始する', (options) => {
    expect(createInstallExperience(createFakeWindow(options)).getState()).toBe('installed')
  })

  it('beforeinstallpromptを保持してinstallableへ遷移する', async () => {
    const target = createFakeWindow()
    const experience = createInstallExperience(target)
    const listener = vi.fn()
    const unsubscribe = experience.subscribe(listener)
    const { event, prompt } = createInstallPromptEvent('accepted')
    const preventDefault = vi.spyOn(event, 'preventDefault')

    target.dispatchEvent(event)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(experience.getState()).toBe('installable')
    expect(listener).toHaveBeenCalledOnce()
    expect(await experience.install()).toBe('accepted')
    expect(prompt).toHaveBeenCalledOnce()

    const callCountBeforeUnsubscribe = listener.mock.calls.length
    unsubscribe()
    target.dispatchEvent(new Event('appinstalled'))
    expect(listener).toHaveBeenCalledTimes(callCountBeforeUnsubscribe)
  })

  it('appinstalled後はinstalledへ遷移する', () => {
    const target = createFakeWindow()
    const experience = createInstallExperience(target)
    target.dispatchEvent(new Event('appinstalled'))
    expect(experience.getState()).toBe('installed')
  })

  it('保持イベントがないinstallはdismissedを返しdestroy後はイベントを無視する', async () => {
    const target = createFakeWindow()
    const experience = createInstallExperience(target)
    experience.destroy()
    const { event } = createInstallPromptEvent('accepted')
    target.dispatchEvent(event)

    expect(experience.getState()).toBe('waiting')
    await expect(experience.install()).resolves.toBe('dismissed')
  })
})
