import type { AllowedVideoType } from '../types/reel.types'

export const REEL_UPLOAD_PURPOSE = 'reel' as const

export const buildReelUploadRequest = ({
  fileType,
  publishIntentId,
}: {
  fileType: AllowedVideoType
  publishIntentId: string
}) => ({
  fileType,
  purpose: REEL_UPLOAD_PURPOSE,
  publishIntentId,
})

export const isUploadAlreadyPresentStatus = (status: number) => status === 412

const getErrorStatus = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const response = (error as { response?: { status?: unknown } }).response
  return typeof response?.status === 'number' ? response.status : undefined
}

const getErrorMessage = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const candidate = error as {
    message?: unknown
    response?: { data?: { message?: unknown } }
  }
  const responseMessage = candidate.response?.data?.message
  return typeof responseMessage === 'string'
    ? responseMessage
    : typeof candidate.message === 'string'
      ? candidate.message
      : ''
}

export const isUploadedSourceMissingError = (error: unknown) => {
  const status = getErrorStatus(error)
  const message = getErrorMessage(error).toLowerCase()
  if (
    status === 400 &&
    (message.includes('invalid media file') ||
      message.includes('uploaded reel video file does not exist'))
  )
    return true
  if (status === 409 && message.includes('upload lease')) return true
  if (status !== 404 && status !== 410 && status !== 422) {
    return false
  }

  return (
    message.includes('media') ||
    message.includes('upload') ||
    message.includes('source') ||
    message.includes('object') ||
    message.includes('key')
  )
}

export const shouldReuploadAfterCreateSourceMiss = ({
  alreadyUploaded,
  canonicalReelFound,
  error,
}: {
  alreadyUploaded: boolean
  canonicalReelFound: boolean
  error: unknown
}) => alreadyUploaded && !canonicalReelFound && isUploadedSourceMissingError(error)

export const markMediaUploadIncomplete = <
  T extends { completedSteps: string[]; uploadedAt?: number },
>(
  operation: T,
) => {
  const nextOperation = {
    ...operation,
    completedSteps: operation.completedSteps.filter((step) => step !== 'media_uploaded'),
  }
  delete nextOperation.uploadedAt
  return nextOperation
}

export type ReelPlaybackCandidate = 'local' | 'remote' | 'offline'

export const createPlaybackCandidateAttempts = () => new Set<ReelPlaybackCandidate>()

export const tryPlaybackCandidate = (
  attempts: Set<ReelPlaybackCandidate>,
  candidate: ReelPlaybackCandidate,
) => {
  if (attempts.has(candidate)) {
    return false
  }

  attempts.add(candidate)
  return true
}
