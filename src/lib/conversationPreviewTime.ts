import {
  addMonths,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInWeeks,
} from 'date-fns'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const THIRTY_DAYS_MS = 30 * DAY_MS

const toDate = (value: string | number | Date) => {
  return value instanceof Date ? value : new Date(value)
}

export const formatConversationPreviewAge = (
  dateString: string,
  nowInput: number | Date = Date.now(),
) => {
  const date = new Date(dateString)

  if (isNaN(date.getTime())) {
    return ''
  }

  const now = toDate(nowInput)
  const minutes = differenceInMinutes(now, date)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`

  const hours = differenceInHours(now, date)
  if (hours < 24) return `${hours}h`

  const days = differenceInDays(now, date)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.max(1, differenceInWeeks(now, date))}w`

  return `${Math.max(1, differenceInMonths(now, date))}mo`
}

export const getNextConversationPreviewRefreshAt = (
  dateString: string,
  nowInput: number | Date = Date.now(),
) => {
  const date = new Date(dateString)

  if (isNaN(date.getTime())) {
    return null
  }

  const now = toDate(nowInput)
  const nowTimestamp = now.getTime()
  const dateTimestamp = date.getTime()

  if (dateTimestamp > nowTimestamp) {
    return dateTimestamp + MINUTE_MS
  }

  const minutes = differenceInMinutes(now, date)
  if (minutes < 60) {
    return dateTimestamp + Math.max(1, minutes + 1) * MINUTE_MS
  }

  const hours = differenceInHours(now, date)
  if (hours < 24) {
    return dateTimestamp + (hours + 1) * HOUR_MS
  }

  const days = differenceInDays(now, date)
  if (days < 7) {
    return dateTimestamp + (days + 1) * DAY_MS
  }

  if (days < 30) {
    const displayedWeeks = Math.max(1, differenceInWeeks(now, date))
    const nextWeekAt = dateTimestamp + (displayedWeeks + 1) * WEEK_MS
    const monthBucketAt = dateTimestamp + THIRTY_DAYS_MS
    return Math.min(nextWeekAt, monthBucketAt)
  }

  const displayedMonths = Math.max(1, differenceInMonths(now, date))
  return addMonths(date, displayedMonths + 1).getTime()
}
