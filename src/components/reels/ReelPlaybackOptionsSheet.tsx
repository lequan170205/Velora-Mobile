import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import React, { useCallback } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../constants/theme'

import type { ReelPlaybackSpeed } from '../../lib/reelPlaybackPreferences'

interface ReelPlaybackOptionsSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>
  transcriptionEnabled: boolean
  onTranscriptionChange: (enabled: boolean) => void
  playbackSpeed: ReelPlaybackSpeed
  onPlaybackSpeedChange: (speed: ReelPlaybackSpeed) => void
  onClearDisplay: () => void
  onClose?: () => void
}

const PLAYBACK_SPEEDS: ReelPlaybackSpeed[] = [0.5, 1, 1.5, 2]

export function ReelPlaybackOptionsSheet({
  sheetRef,
  transcriptionEnabled,
  onTranscriptionChange,
  playbackSpeed,
  onPlaybackSpeedChange,
  onClearDisplay,
  onClose,
}: ReelPlaybackOptionsSheetProps) {
  const insets = useSafeAreaInsets()

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.46}
        pressBehavior="close"
      />
    ),
    [],
  )

  const handleClearDisplay = useCallback(() => {
    sheetRef.current?.dismiss()
    onClearDisplay()
  }, [onClearDisplay, sheetRef])

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      enableDynamicSizing
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
      {...(onClose ? { onDismiss: onClose } : {})}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 18) }}>
        <View className="px-5 pb-1">
          <View className="mt-1 flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="font-heading text-xl text-text-primary">Playback</Text>
              <Text className="mt-1 text-base2 text-text-secondary">Reel viewing controls</Text>
            </View>

            <Pressable
              accessibilityLabel="Close playback options"
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
              onPress={() => sheetRef.current?.dismiss()}
            >
              <MaterialIcons name="close" size={20} color={colors.text.primary} />
            </Pressable>
          </View>

          <Text className="mb-3 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Captions
          </Text>
          <Pressable
            accessibilityLabel="Live transcription"
            accessibilityHint="Turns synchronized reel captions on or off"
            accessibilityRole="button"
            accessibilityState={{ selected: transcriptionEnabled }}
            className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-3.5"
            onPress={() => onTranscriptionChange(!transcriptionEnabled)}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-soft">
              <MaterialIcons name="subtitles" size={20} color={colors.brand.primary} />
            </View>
            <View className="ml-3 flex-1 pr-3">
              <Text className="font-medium text-md text-text-primary">Live transcription</Text>
              <Text className="mt-0.5 text-sm2 text-text-secondary">
                {transcriptionEnabled
                  ? 'Captions are on · tap to turn off'
                  : 'Captions are off · tap to turn on'}
              </Text>
            </View>
            <MaterialIcons
              name={transcriptionEnabled ? 'check-circle' : 'chevron-right'}
              size={20}
              color={transcriptionEnabled ? colors.brand.primary : colors.text.tertiary}
            />
          </Pressable>

          <Text className="mb-3 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Display
          </Text>
          <Pressable
            accessibilityLabel="Clear display"
            accessibilityHint="Hides reel controls and text so only the video remains visible"
            accessibilityRole="button"
            className="flex-row items-center rounded-[24px] bg-surface-muted px-4 py-3.5"
            onPress={handleClearDisplay}
          >
            <View className="h-11 w-11 items-center justify-center rounded-full bg-white">
              <MaterialIcons name="visibility-off" size={20} color={colors.text.primary} />
            </View>
            <View className="ml-3 flex-1 pr-3">
              <Text className="font-medium text-md text-text-primary">Clear display</Text>
              <Text className="mt-0.5 text-sm2 text-text-secondary">
                Hide controls and text to focus on the video
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={colors.text.tertiary} />
          </Pressable>

          <Text className="mb-3 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Playback speed
          </Text>
          <View className="flex-row gap-2">
            {PLAYBACK_SPEEDS.map((speed) => {
              const selected = playbackSpeed === speed

              return (
                <Pressable
                  key={speed}
                  accessibilityLabel={`${speed}x playback speed`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={
                    selected
                      ? 'h-11 flex-1 items-center justify-center rounded-full bg-brand'
                      : 'h-11 flex-1 items-center justify-center rounded-full bg-surface-muted'
                  }
                  onPress={() => onPlaybackSpeedChange(speed)}
                >
                  <Text
                    className={
                      selected
                        ? 'font-semibold text-base2 text-white'
                        : 'font-medium text-base2 text-text-primary'
                    }
                  >
                    {speed}x
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  handleIndicator: {
    backgroundColor: colors.border.strong,
    width: 56,
  },
  sheetBackground: {
    backgroundColor: colors.surface.modal,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
})
