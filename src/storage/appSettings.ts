import { z } from 'zod'

const SETTINGS_KEY = 'imakoko-info:settings'
const LEGACY_INTRO_KEY = 'imacoco:intro-seen'

const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  onboardingAccepted: z.boolean(),
  installPromptSeen: z.boolean().default(false),
  expandedCards: z.array(z.string()),
  theme: z.enum(['system', 'light', 'dark']),
  lastSeenAppVersion: z.string()
})

export type AppSettings = z.infer<typeof appSettingsSchema>

const defaultSettings = (): AppSettings => ({
  schemaVersion: 1,
  onboardingAccepted: false,
  installPromptSeen: false,
  expandedCards: [],
  theme: 'system',
  lastSeenAppVersion: '0.1.0'
})

export function readAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = appSettingsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    }

    const settings = defaultSettings()
    if (localStorage.getItem(LEGACY_INTRO_KEY) === '1') settings.onboardingAccepted = true
    return settings
  } catch {
    return defaultSettings()
  }
}

export function updateAppSettings(update: Partial<Omit<AppSettings, 'schemaVersion'>>) {
  const next = appSettingsSchema.parse({ ...readAppSettings(), ...update, schemaVersion: 1 })
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    localStorage.removeItem(LEGACY_INTRO_KEY)
  } catch {
    // Settings are an enhancement. A storage restriction must not stop the dashboard.
  }
  return next
}

export function clearAppSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY)
    localStorage.removeItem(LEGACY_INTRO_KEY)
  } catch {
    // Repeating deletion is intentionally safe.
  }
}
