import type { AiRagCitation } from '../types/conversation.types'

export const getMessageBubbleRecyclingKey = (citations?: AiRagCitation[]) => {
  if (!citations?.length) {
    return 'default'
  }

  return JSON.stringify(
    citations.map((citation) => ({
      sourceType: citation.sourceType,
      reelId: citation.reelId,
      evidenceType: citation.evidenceType,
      title: citation.title,
      startTime: citation.startTime,
      endTime: citation.endTime,
      quote: citation.quote,
    })),
  )
}
