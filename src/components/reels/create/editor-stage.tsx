import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import { ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { formatDurationLabel } from '../../../lib/reels'
import { ReelVideo } from '../ReelVideo'

import { GlassIconButton } from './shared-ui'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'

export function EditorStage({ controller }: { controller: ReelCreatorController }) {
  const insets = useSafeAreaInsets()
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const [isPreviewPaused, setIsPreviewPaused] = React.useState(false)
  const [videoDuration, setVideoDuration] = React.useState(0)
  const horizontalPadding = windowWidth < 380 ? 16 : 20
  const safeContentHeight = Math.max(0, windowHeight - insets.top - insets.bottom - 24)
  const headerHeight = 52
  const timelineHeight = windowHeight < 720 ? 124 : 136
  const previewAvailableHeight = Math.max(
    220,
    safeContentHeight - headerHeight - timelineHeight - 20,
  )
  const maxPreviewWidth = windowWidth - horizontalPadding * 2
  const portraitWidthForAvailableHeight = previewAvailableHeight * (9 / 16)
  const previewWidth = Math.min(maxPreviewWidth, Math.max(264, portraitWidthForAvailableHeight))
  const previewHeight = Math.min(previewAvailableHeight, previewWidth * (16 / 9))
  const durationLabel =
    formatDurationLabel(
      controller.videoDurationSeconds > 0
        ? controller.videoDurationSeconds * 1000
        : videoDuration > 0
          ? videoDuration * 1000
          : controller.selectedAsset?.duration,
    ) || '0:00'
  const positionLabel =
    formatDurationLabel(Math.max(controller.videoPlaybackPosition, 0) * 1000) || '0:00'

  React.useEffect(() => {
    setIsPreviewPaused(false)
    setVideoDuration(0)
  }, [controller.selectedAsset?.uri])

  if (!controller.selectedAsset) {
    return null
  }

  return (
    <Animated.View
      className="flex-1 bg-[#F7F2EC]"
      entering={FadeIn.duration(180)}
      style={{
        paddingHorizontal: horizontalPadding,
        paddingTop: insets.top + 12,
        paddingBottom: Math.max(insets.bottom + 12, 12),
      }}
    >
      <View className="justify-center" style={{ height: headerHeight }}>
        <View className="absolute left-0 z-10">
          <GlassIconButton icon="arrow-back" tone="light" onPress={controller.goToCaptureStage} />
        </View>

        <View className="absolute left-16 right-24 items-center">
          <Text
            className="text-xs2 uppercase tracking-[1.2px]"
            style={{ color: 'rgba(46,36,30,0.58)' }}
          >
            Preview
          </Text>
          <Text
            className="mt-1 font-heading text-[22px]"
            style={{ color: '#17120F' }}
            numberOfLines={1}
          >
            Preview clip
          </Text>
        </View>

        <TouchableOpacity
          className="absolute right-0 rounded-full bg-[#FF7A45] px-5 py-3"
          activeOpacity={0.84}
          onPress={controller.goToPublishStage}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Next</Text>
        </TouchableOpacity>
      </View>

      <View className="mt-2 items-center">
        <View
          className="overflow-hidden rounded-[30px] border border-[#E5D8CC] bg-[#17120F]"
          style={{
            width: previewWidth,
            height: previewHeight,
            shadowColor: 'rgba(86, 58, 35, 0.16)',
            shadowOffset: { width: 0, height: 18 },
            shadowOpacity: 1,
            shadowRadius: 30,
            elevation: 6,
          }}
        >
          <ReelVideo
            uri={controller.selectedAsset.uri}
            {...(controller.thumbnailUri ? { posterUri: controller.thumbnailUri } : {})}
            shouldPlay={!isPreviewPaused}
            loop
            muted={controller.isPreviewMuted}
            contentFit="cover"
            onProgress={(progress) => {
              if (progress.duration > 0 && videoDuration === 0) {
                setVideoDuration(progress.duration)
              }
              controller.handleEditorProgress(progress)
            }}
            style={{ width: '100%', height: '100%', backgroundColor: '#17120F' }}
          />

          <View className="absolute inset-x-0 bottom-0 px-3 pb-3">
            <View className="flex-row items-center justify-between rounded-full bg-white/92 px-3 py-2">
              <Text style={{ color: '#17120F', fontSize: 12, fontWeight: '800' }}>
                {positionLabel} / {durationLabel}
              </Text>
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="h-9 w-9 items-center justify-center rounded-full bg-[#17120F]"
                  activeOpacity={0.84}
                  onPress={controller.togglePreviewMuted}
                >
                  <MaterialIcons
                    name={controller.isPreviewMuted ? 'volume-off' : 'volume-up'}
                    size={18}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  className="h-9 w-9 items-center justify-center rounded-full bg-[#FF7A45]"
                  activeOpacity={0.84}
                  onPress={() => {
                    setIsPreviewPaused((current) => !current)
                  }}
                >
                  <MaterialIcons
                    name={isPreviewPaused ? 'play-arrow' : 'pause'}
                    size={20}
                    color="#FFFFFF"
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View
        className="mt-2 rounded-[24px] border border-[#E6DAD0] bg-white px-3 py-3"
        style={{ height: timelineHeight }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
              Timeline
            </Text>
            <Text
              className="mt-0.5 text-xs2"
              style={{ color: 'rgba(46,36,30,0.62)' }}
              numberOfLines={1}
            >
              {controller.orientationMessage}
            </Text>
          </View>

          <View className="rounded-full bg-[#FFF0E8] px-3 py-2">
            <Text style={{ color: '#D85A21', fontWeight: '700' }}>
              {controller.selectedAssetType
                ? controller.selectedAssetType.replace('video/', '').toUpperCase()
                : 'VIDEO'}
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-2"
          contentContainerStyle={{ gap: 8 }}
        >
          {(controller.timelineFrames.length > 0
            ? controller.timelineFrames
            : [{ uri: controller.selectedAsset.uri, timeMs: 0 }]
          ).map((frame, index) => (
            <View
              key={`${frame.uri}-${frame.timeMs}-${index}`}
              className="overflow-hidden rounded-[16px] border border-[#E9DED5] bg-[#F7F2EC]"
            >
              <Image
                source={{ uri: frame.uri }}
                contentFit="cover"
                style={{
                  width: windowHeight < 720 ? 48 : 54,
                  height: windowHeight < 720 ? 58 : 66,
                }}
              />
            </View>
          ))}
        </ScrollView>
      </View>
    </Animated.View>
  )
}
