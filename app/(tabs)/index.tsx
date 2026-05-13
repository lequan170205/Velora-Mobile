import { MaterialIcons } from '@expo/vector-icons'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ConversationItem } from '../../src/components/chat/ConversationItem'
import { useBotChat } from '../../src/hooks/useBotChat'
import { useConversations } from '../../src/hooks/useConversations'

export default function ConversationsScreen() {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const { data: conversations, isLoading, isError } = useConversations()
  const { mutate: startBotChat, isPending: isBotLoading } = useBotChat()

  const fabSize = 56
  const fabMargin = 20
  const initialFabPosition = useMemo(
    () => ({
      x: Math.max(fabMargin, width - fabSize - fabMargin),
      y: Math.max(fabMargin, height - insets.bottom - fabSize - 96),
    }),
    [fabSize, fabMargin, height, insets.bottom, width],
  )
  const fabPosition = useRef(new Animated.ValueXY(initialFabPosition)).current
  const currentFabPosition = useRef(initialFabPosition)
  const hasMovedFab = useRef(false)

  useEffect(() => {
    if (hasMovedFab.current) return

    fabPosition.setValue(initialFabPosition)
    currentFabPosition.current = initialFabPosition
  }, [fabPosition, initialFabPosition])

  useEffect(() => {
    const listenerId = fabPosition.addListener((value) => {
      currentFabPosition.current = value
    })

    return () => {
      fabPosition.removeListener(listenerId)
    }
  }, [fabPosition])

  const settleFabPosition = useCallback(() => {
    fabPosition.flattenOffset()

    const minX = fabMargin
    const maxX = Math.max(minX, width - fabSize - fabMargin)
    const minY = insets.top + fabMargin
    const maxY = Math.max(minY, height - insets.bottom - fabSize - 88)
    const nextPosition = {
      x: Math.min(Math.max(currentFabPosition.current.x, minX), maxX),
      y: Math.min(Math.max(currentFabPosition.current.y, minY), maxY),
    }

    Animated.spring(fabPosition, {
      toValue: nextPosition,
      useNativeDriver: false,
    }).start()
  }, [fabMargin, fabPosition, fabSize, height, insets.bottom, insets.top, width])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gestureState) =>
          Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
        onPanResponderGrant: () => {
          hasMovedFab.current = true
          fabPosition.extractOffset()
        },
        onPanResponderMove: Animated.event([null, { dx: fabPosition.x, dy: fabPosition.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: () => {
          settleFabPosition()
        },
        onPanResponderTerminate: () => {
          settleFabPosition()
        },
      }),
    [fabPosition, settleFabPosition],
  )

  const handleBotChat = () => {
    startBotChat(undefined, {
      onError: () => {
        Alert.alert('Error', 'Could not open bot conversation. Please try again.')
      },
    })
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <ActivityIndicator color="#0A7CFF" size="large" />
      </View>
    )
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-primary">
        <Text className="text-status-error font-medium text-md">Failed to load conversations</Text>
      </View>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-bg-primary">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-4 pb-4 z-10">
        <Text className="text-text-primary font-bold text-display">Messages</Text>
        <View className="flex-row items-center gap-3">
          {/* Compose button */}
          <TouchableOpacity className="w-10 h-10 rounded-full bg-surface-card items-center justify-center">
            <MaterialIcons name="edit" size={24} color="#f8fafc" />
          </TouchableOpacity>
        </View>
      </View>

      {/* List */}
      <View className="flex-1 z-10">
        <FlatList
          data={conversations || []}
          renderItem={({ item }) => <ConversationItem conversation={item} />}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={10}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={true}
          ListEmptyComponent={
            <View className="items-center p-8">
              <Text className="text-text-secondary font-sans text-base2">
                No conversations yet. Start chatting!
              </Text>
            </View>
          }
        />
      </View>

      <Animated.View
        className="absolute z-20"
        style={{
          transform: fabPosition.getTranslateTransform(),
        }}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          className="w-14 h-14 rounded-full bg-brand items-center justify-center"
          onPress={handleBotChat}
          disabled={isBotLoading}
          activeOpacity={0.85}
          style={{
            width: fabSize,
            height: fabSize,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.28,
            shadowRadius: 10,
            elevation: 8,
          }}
        >
          {isBotLoading ? (
            <ActivityIndicator color="#f8fafc" size="small" />
          ) : (
            <MaterialIcons name="smart-toy" size={26} color="#f8fafc" />
          )}
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  )
}
