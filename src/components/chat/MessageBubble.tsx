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
  // Keep the key stable across ordinary recycled messages. A key tied to
  // message.id forces React to remount the entire heavy bubble subtree every
  // time FlashList reuses a cell, defeating view recycling during fast flings.
  // Citation-only metadata changes still get a deliberate remount because the
  // memo comparator in MessageBubbleImpl does not otherwise observe citations.
  return <MemoizedMessageBubble key={getCitationRenderKey(props)} {...props} />
}
