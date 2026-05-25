import { useLocalSearchParams } from 'expo-router'
import React from 'react'

import { ReelsViewer } from '../../../src/components/reels/ReelsViewer'

export default function ReelContextScreen() {
  const { id, source, returnTo, returnUsername } = useLocalSearchParams<{
    id?: string | string[]
    source?: string | string[]
    returnTo?: string | string[]
    returnUsername?: string | string[]
  }>()
  const reelId = Array.isArray(id) ? id[0] : id
  const contextSource = Array.isArray(source) ? source[0] : source
  const normalizedReturnTo = Array.isArray(returnTo) ? returnTo[0] : returnTo
  const normalizedReturnUsername = Array.isArray(returnUsername)
    ? returnUsername[0]
    : returnUsername

  if (!reelId) {
    return <ReelsViewer mode="public" />
  }

  return (
    <ReelsViewer
      mode="context"
      reelId={reelId}
      contextSource={contextSource === 'public' ? 'public' : 'profile'}
      returnTo={normalizedReturnTo}
      returnUsername={normalizedReturnUsername}
    />
  )
}
