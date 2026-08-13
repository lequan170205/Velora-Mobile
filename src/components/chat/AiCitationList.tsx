import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'

import { queueReelInitialSeek } from '../../lib/reelPlaybackCoordinator'

import type { AiRagCitation } from '../../types/conversation.types'

interface AiCitationListProps {
  citations: AiRagCitation[]
  conversationId: string
}

const EVIDENCE_LABELS: Record<AiRagCitation['evidenceType'], string> = {
  TRANSCRIPT: 'Transcript',
  VISUAL: 'Visual',
  METADATA: 'Metadata',
}

const EVIDENCE_ICONS: Record<
  AiRagCitation['evidenceType'],
  'graphic-eq' | 'visibility' | 'description'
> = {
  TRANSCRIPT: 'graphic-eq',
  VISUAL: 'visibility',
  METADATA: 'description',
}

const formatTimestamp = (seconds?: number) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }

  const wholeSeconds = Math.floor(seconds)
  const minutes = Math.floor(wholeSeconds / 60)
  const remainder = wholeSeconds % 60

  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

export function AiCitationList({ citations, conversationId }: AiCitationListProps) {
  const router = useRouter()

  const openCitation = useCallback(
    (citation: AiRagCitation) => {
      if (typeof citation.startTime === 'number' && citation.startTime >= 0) {
        queueReelInitialSeek(citation.reelId, citation.startTime)
      }

      router.push({
        pathname: '/reels/[id]',
        params: {
          id: citation.reelId,
          source: 'chat',
          returnTo: 'conversation',
          conversationId,
          ...(typeof citation.startTime === 'number'
            ? { startTime: String(citation.startTime) }
            : {}),
        },
      })
    },
    [conversationId, router],
  )

  if (citations.length === 0) {
    return null
  }

  return (
    <View className="mt-2.5">
      <Text className="mb-1.5 text-xs2 font-medium text-text-muted">Sources</Text>

      <View className="flex-row flex-wrap gap-2">
        {citations.map((citation, index) => {
          const timestamp = formatTimestamp(citation.startTime)
          const label = timestamp
            ? `${EVIDENCE_LABELS[citation.evidenceType]} · ${timestamp}`
            : EVIDENCE_LABELS[citation.evidenceType]
          const accessibilityHint = citation.quote
            ? `Opens the cited reel. Evidence: ${citation.quote}`
            : 'Opens the cited reel.'
          const key = [
            citation.reelId,
            citation.evidenceType,
            citation.startTime ?? 'none',
            index,
          ].join(':')

          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Source: ${label}`}
              accessibilityHint={accessibilityHint}
              className="flex-row items-center rounded-full border border-black/8 bg-black/5 px-2.5 py-1.5 active:bg-black/10"
              onPress={() => {
                openCitation(citation)
              }}
            >
              <MaterialIcons
                name={EVIDENCE_ICONS[citation.evidenceType]}
                size={14}
                color="#6B625C"
              />
              <Text className="ml-1.5 text-xs2 font-medium text-[#5F5752]">{label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
