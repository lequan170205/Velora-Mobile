import type { Conversation } from '../types/conversation.types'

const getEmailLabel = (email?: string | null) => {
  const normalizedEmail = email?.trim()
  return normalizedEmail ? normalizedEmail.split('@')[0] || normalizedEmail : ''
}

export const getReplyPreviewSenderName = ({
  conversation,
  currentUserId,
  senderEmail,
  senderId,
}: {
  conversation?: Conversation | null
  currentUserId?: string | null
  senderEmail?: string | null
  senderId?: string | null
}) => {
  if (currentUserId && senderId === currentUserId) {
    return 'You'
  }

  const participant = conversation?.participants?.find((candidate) => candidate.id === senderId)
  const participantName = participant?.name?.trim()
  if (participantName) {
    return participantName
  }

  const participantEmailLabel = getEmailLabel(participant?.email)
  if (participantEmailLabel) {
    return participantEmailLabel
  }

  const senderEmailLabel = getEmailLabel(senderEmail)
  return senderEmailLabel || 'User'
}
