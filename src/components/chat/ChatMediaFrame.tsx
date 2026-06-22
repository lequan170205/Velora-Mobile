import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React, { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'

import { isRemoteMediaUri } from '../../lib/chatMedia'

type ChatMediaKind = 'image' | 'video'

interface ChatMediaFrameProps {
  kind: ChatMediaKind
  uri?: string | null
  style: StyleProp<ViewStyle>
  contentFit?: React.ComponentProps<typeof Image>['contentFit']
  accessibilityLabel?: string
  disableTransition?: boolean
  showPlaceholder?: boolean
  placeholderLabel?: string
  children?: ReactNode
}

const FRAME_BACKGROUND: Record<ChatMediaKind, string> = {
  image: '#EFEFEF',
  video: '#0C0C0D',
}

const PLACEHOLDER_ICON_COLOR: Record<ChatMediaKind, string> = {
  image: '#A1A1AA',
  video: '#D4D4D8',
}

const PLACEHOLDER_TEXT_COLOR: Record<ChatMediaKind, string> = {
  image: '#52525B',
  video: '#F4F4F5',
}

const PLACEHOLDER_ICON_NAME: Record<ChatMediaKind, 'image' | 'videocam'> = {
  image: 'image',
  video: 'videocam',
}

export function ChatMediaFrame({
  kind,
  uri,
  style,
  contentFit = 'cover',
  accessibilityLabel,
  disableTransition = false,
  showPlaceholder = false,
  placeholderLabel,
  children,
}: ChatMediaFrameProps) {
  const [hasLoadError, setHasLoadError] = useState(false)
  const resolvedUri = typeof uri === 'string' && uri.length > 0 ? uri : null

  useEffect(() => {
    setHasLoadError(false)
  }, [showPlaceholder, uri])

  const shouldShowPlaceholder = showPlaceholder || !resolvedUri || hasLoadError
  const cachePolicy = isRemoteMediaUri(resolvedUri) ? 'memory-disk' : 'memory'

  return (
    <View style={[styles.frame, { backgroundColor: FRAME_BACKGROUND[kind] }, style]}>
      {shouldShowPlaceholder ? (
        <View style={styles.placeholder}>
          <MaterialIcons
            color={PLACEHOLDER_ICON_COLOR[kind]}
            name={PLACEHOLDER_ICON_NAME[kind]}
            size={28}
          />
          {placeholderLabel ? (
            <Text style={[styles.placeholderLabel, { color: PLACEHOLDER_TEXT_COLOR[kind] }]}>
              {placeholderLabel}
            </Text>
          ) : null}
        </View>
      ) : (
        <Image
          cachePolicy={cachePolicy}
          contentFit={contentFit}
          onError={() => setHasLoadError(true)}
          recyclingKey={resolvedUri}
          source={{ uri: resolvedUri }}
          style={StyleSheet.absoluteFillObject}
          transition={disableTransition ? 0 : 150}
          {...(accessibilityLabel ? { accessibilityLabel } : {})}
        />
      )}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    position: 'relative',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  placeholderLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
})
