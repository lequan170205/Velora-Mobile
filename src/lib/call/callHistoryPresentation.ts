import { differenceInCalendarDays, format } from 'date-fns'

import type {
  CallLog,
  CallLogOutcome,
  CallLogParticipant,
  CallLogParticipantResult,
} from '../../types/conversation.types'

/**
 * Wording for one finished call from the viewer's side. Shared by the call row
 * in chat and the Calls tab so both always say the same thing.
 */
export type CallViewerInput = {
  callType: 'VOICE' | 'VIDEO'
  isGroupCall: boolean
  outcome: CallLogOutcome
  terminalReason?: string
  durationSec?: number
  /** null when the viewer was not part of the call (e.g. an uninvited group member). */
  role: CallLogParticipant['role'] | null
  result: CallLogParticipantResult | null
}

export type CallPresentationIcon =
  'call-made' | 'call-received' | 'call-missed' | 'call-missed-outgoing' | 'call-end'

export type CallPresentation = {
  title: string
  /** Talk time such as "3:12" when the call connected. */
  detail: string | null
  icon: CallPresentationIcon
  /** The viewer missed this call: shown in the error colour. */
  isMissed: boolean
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const formatCallDuration = (totalSeconds: number) => {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** "14:05" today, "Yesterday", a weekday within a week, else "3 Oct". */
export const formatCallListTime = (iso: string, now: Date = new Date()) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  const days = differenceInCalendarDays(now, date)
  if (days <= 0) return format(date, 'HH:mm')
  if (days === 1) return 'Yesterday'
  if (days < 7) return format(date, 'EEE')
  return format(date, 'd MMM')
}

export const getCallKindLabel = (callType: 'VOICE' | 'VIDEO', isGroupCall: boolean) =>
  `${isGroupCall ? 'group ' : ''}${callType === 'VIDEO' ? 'video' : 'voice'} call`

export const describeCallForViewer = (input: CallViewerInput): CallPresentation => {
  const kind = getCallKindLabel(input.callType, input.isGroupCall)
  const duration =
    input.durationSec !== undefined && input.durationSec > 0
      ? formatCallDuration(input.durationSec)
      : null

  if (input.role === 'CALLEE') {
    switch (input.result) {
      case 'MISSED':
        return { title: `Missed ${kind}`, detail: null, icon: 'call-missed', isMissed: true }
      case 'DECLINED':
        return { title: `Declined ${kind}`, detail: null, icon: 'call-end', isMissed: false }
      case 'FAILED':
        return {
          title: `${capitalize(kind)} failed`,
          detail: null,
          icon: 'call-end',
          isMissed: false,
        }
      default:
        return {
          title: `Incoming ${kind}`,
          detail: duration,
          icon: 'call-received',
          isMissed: false,
        }
    }
  }

  if (input.role === 'CALLER') {
    switch (input.result) {
      case 'CANCELLED':
        return {
          title:
            input.terminalReason === 'busy'
              ? 'Line busy'
              : input.terminalReason === 'no_answer' || input.terminalReason === 'timeout'
                ? 'No answer'
                : `Cancelled ${kind}`,
          detail: null,
          icon: 'call-missed-outgoing',
          isMissed: false,
        }
      case 'DECLINED':
        return {
          title: `${capitalize(kind)} declined`,
          detail: null,
          icon: 'call-missed-outgoing',
          isMissed: false,
        }
      case 'FAILED':
        return {
          title: `${capitalize(kind)} failed`,
          detail: null,
          icon: 'call-end',
          isMissed: false,
        }
      default:
        return { title: `Outgoing ${kind}`, detail: duration, icon: 'call-made', isMissed: false }
    }
  }

  return {
    title: capitalize(kind),
    detail: input.outcome === 'COMPLETED' ? duration : null,
    icon: 'call-end',
    isMissed: false,
  }
}

/** The viewer's own part in a logged call, if any. */
export const getCallLogViewerParticipant = (
  callLog: CallLog,
  viewerId: string | null | undefined,
): CallLogParticipant | null =>
  (viewerId && callLog.participants.find((participant) => participant.userId === viewerId)) || null

export const describeCallLogForViewer = (
  callLog: CallLog,
  viewerId: string | null | undefined,
): CallPresentation => {
  const participant = getCallLogViewerParticipant(callLog, viewerId)

  return describeCallForViewer({
    callType: callLog.callType,
    isGroupCall: callLog.isGroupCall,
    outcome: callLog.outcome,
    ...(callLog.terminalReason ? { terminalReason: callLog.terminalReason } : {}),
    ...(callLog.durationSec !== undefined ? { durationSec: callLog.durationSec } : {}),
    role: participant?.role ?? null,
    result: participant?.result ?? null,
  })
}
