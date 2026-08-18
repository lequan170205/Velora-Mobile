import React from 'react'

import { getMessageBubbleRecyclingKey } from '../../lib/messageBubbleRecycling'

import { MessageBubble as MemoizedMessageBubble } from './MessageBubbleImpl'

export { VALID_EMOJIS } from './MessageBubbleImpl'
export type { MessageBubbleContextMenuPayload } from './MessageBubbleImpl'

type MessageBubbleProps = React.ComponentProps<typeof MemoizedMessageBubble>

export function MessageBubble(props: MessageBubbleProps) {
  return (
    <MemoizedMessageBubble
      key={getMessageBubbleRecyclingKey(props.message.metadata?.citations)}
      {...props}
    />
  )
}
