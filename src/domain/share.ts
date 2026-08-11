export type ShareSelection = {
  place: boolean
  checkedAt: boolean
  weather: boolean
  solar: boolean
  tide: boolean
  government: boolean
}

export type ShareContent = Partial<Record<keyof ShareSelection, string>>

export const defaultShareSelection: ShareSelection = {
  place: true,
  checkedAt: true,
  weather: true,
  solar: true,
  tide: true,
  government: true
}

const labels: Record<keyof ShareSelection, string> = {
  place: '現在地',
  checkedAt: '確認時刻',
  weather: '天気',
  solar: '太陽',
  tide: '潮の目安',
  government: '役所'
}

export function buildShareText(
  content: ShareContent,
  selection: ShareSelection,
  appUrl?: string
) {
  const lines = ['いまここインフォ']
  for (const key of Object.keys(selection) as Array<keyof ShareSelection>) {
    if (selection[key] && content[key]) lines.push(`${labels[key]}: ${content[key]}`)
  }
  if (appUrl) lines.push('', appUrl)
  return lines.join('\n')
}
