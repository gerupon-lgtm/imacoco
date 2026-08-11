export type InstallExperienceState = 'waiting' | 'ios' | 'installable' | 'installed'
export type InstallOutcome = 'accepted' | 'dismissed'

export type InstallExperience = {
  getState(): InstallExperienceState
  subscribe(listener: () => void): () => void
  install(): Promise<InstallOutcome>
  destroy(): void
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>
  userChoice: Promise<{
    outcome: InstallOutcome
    platform: string
  }>
}

function isIosLike(navigator: Navigator) {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandalone(target: Window) {
  return target.matchMedia('(display-mode: standalone)').matches
    || (target.navigator as NavigatorWithStandalone).standalone === true
}

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  const candidate = event as Partial<BeforeInstallPromptEvent>
  return typeof candidate.prompt === 'function' && candidate.userChoice instanceof Promise
}

export function createInstallExperience(target: Window): InstallExperience {
  let state: InstallExperienceState = isStandalone(target)
    ? 'installed'
    : isIosLike(target.navigator)
      ? 'ios'
      : 'waiting'
  let deferredPrompt: BeforeInstallPromptEvent | undefined
  const listeners = new Set<() => void>()

  const setState = (next: InstallExperienceState) => {
    if (next === state) return
    state = next
    listeners.forEach((listener) => listener())
  }

  const handleBeforeInstallPrompt = (event: Event) => {
    if (!isBeforeInstallPromptEvent(event) || state === 'installed') return
    event.preventDefault()
    deferredPrompt = event
    setState('installable')
  }

  const handleInstalled = () => {
    deferredPrompt = undefined
    setState('installed')
  }

  target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  target.addEventListener('appinstalled', handleInstalled)

  return {
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async install() {
      const promptEvent = deferredPrompt
      if (!promptEvent) return 'dismissed'

      await promptEvent.prompt()
      const choice = await promptEvent.userChoice
      deferredPrompt = undefined
      if (state !== 'installed') setState('waiting')
      return choice.outcome
    },
    destroy() {
      target.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      target.removeEventListener('appinstalled', handleInstalled)
      deferredPrompt = undefined
      listeners.clear()
    }
  }
}
