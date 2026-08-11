const JST_TIME_ZONE = 'Asia/Tokyo'

const datePartsFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short'
})

const timePartsFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = parts.find((part) => part.type === type)?.value

  if (!value) {
    throw new Error(`日時の${type}を取得できませんでした`)
  }

  return value
}

export type JstDateTimeLabel = {
  dateLabel: string
  timeLabel: string
}

export function formatJstDateTime(instant: Date): JstDateTimeLabel {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('有効な日時を指定してください')
  }

  const dateParts = datePartsFormatter.formatToParts(instant)
  const timeParts = timePartsFormatter.formatToParts(instant)

  const year = partValue(dateParts, 'year')
  const month = partValue(dateParts, 'month')
  const day = partValue(dateParts, 'day')
  const weekday = partValue(dateParts, 'weekday')
  const hour = partValue(timeParts, 'hour').padStart(2, '0')
  const minute = partValue(timeParts, 'minute').padStart(2, '0')

  return {
    dateLabel: `${year}年${month}月${day}日（${weekday}）`,
    timeLabel: `${hour}:${minute}`
  }
}

export function millisecondsUntilNextMinute(instant: Date) {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('有効な日時を指定してください')
  }

  return 60_000 - (instant.getSeconds() * 1_000 + instant.getMilliseconds())
}
