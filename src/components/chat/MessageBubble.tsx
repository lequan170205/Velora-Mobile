import React from 'react'

import { MessageBubble as MemoizedMessageBubble } from './MessageBubbleImpl'

export { VALID_EMOJIS } from './MessageBubbleImpl'
export type { MessageBubbleContextMenuPayload } from './MessageBubbleImpl'

type MessageBubbleProps = React.ComponentProps<typeof MemoizedMessageBubble>

const getCitationRenderKey = (props: MessageBubbleProps) =>
  JSON.stringify(
    (props.message.metadata?.citations ?? []).map((citation) => ({
      sourceType: citation.sourceType,
      reelId: citation.reelId,
      evidenceType: citation.evidenceType,
      title: citation.title,
      startTime: citation.startTime,
      endTime: citation.endTime,
      quote: citation.quote,
    })),
  )

export function MessageBubble(props: MessageBubbleProps) {
  return <MemoizedMessageBubble key={`${props.message.id}:${getCitationRenderKey(props)}`} {...props} />
}
