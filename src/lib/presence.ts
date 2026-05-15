import {
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  format,
  isYesterday,
} from 'date-fns'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const toDate = (value: string | number | Date) => {
  return value instanceof Date ? value : new Date(value)
}

export const formatLastSeenLabel = (
  dateString?: string | null,
  nowInput: number | Date = Date.now(),
) => {
  if (!dateString) {
    return 'Offline'
  }

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return 'Offline'
  }

  const now = toDate(nowInput)
  const minutes = differenceInMinutes(now, date)

  if (minutes < 1) return 'Last seen just now'
  if (minutes < 60) return `Last seen ${minutes}m ago`

  const hours = differenceInHours(now, date)
  if (hours < 24) return `Last seen ${hours}h ago`

  if (isYesterday(date)) {
    return `Last seen yesterday at ${format(date, 'h:mm a')}`
  }

  const days = differenceInDays(now, date)
  if (days < 7) return `Last seen ${days}d ago`

  return `Last seen ${format(date, 'dd MMM')}`
}

export const getNextPresenceRefreshAt = (
  dateString?: string | null,
  nowInput: number | Date = Date.now(),
) => {
  if (!dateString) {
    return null
  }

  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  const now = toDate(nowInput)
  const dateTimestamp = date.getTime()
  const nowTimestamp = now.getTime()

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

  return null
}
