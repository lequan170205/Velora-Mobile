import { MaterialIcons } from '@expo/vector-icons'
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet'
import React, { useCallback } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { colors } from '../../constants/theme'

import type { ReelCaptionLanguage, ReelPlaybackSpeed } from '../../lib/reelPlaybackPreferences'

interface ReelPlaybackOptionsSheetProps {
  sheetRef: React.RefObject<BottomSheetModal | null>
  transcriptionEnabled: boolean
  onTranscriptionChange: (enabled: boolean) => void
  captionLanguage: ReelCaptionLanguage
  onCaptionLanguageChange: (language: ReelCaptionLanguage) => void
  playbackSpeed: ReelPlaybackSpeed
  onPlaybackSpeedChange: (speed: ReelPlaybackSpeed) => void
  /** State of the translated captions for the reel on screen; null when nothing is being translated. */
  captionLanguageStatus?: 'loading' | 'error' | null
  onRetryCaptionLanguage?: () => void
  onClearDisplay: () => void
  onClose?: () => void
}

const PLAYBACK_SPEEDS: ReelPlaybackSpeed[] = [0.5, 1, 1.5, 2]

const CAPTION_LANGUAGE_OPTIONS: { value: ReelCaptionLanguage; label: string; name: string }[] = [
  { value: 'original', label: 'Original', name: 'the original language' },
  { value: 'vi', label: 'Tiếng Việt', name: 'Vietnamese' },
  { value: 'en', label: 'English', name: 'English' },
]

export function ReelPlaybackOptionsSheet({
  sheetRef,
  transcriptionEnabled,
  onTranscriptionChange,
  captionLanguage,
  onCaptionLanguageChange,
  playbackSpeed,
  onPlaybackSpeedChange,
  captionLanguageStatus = null,
  onRetryCaptionLanguage,
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

  const selectedLanguageName =
    CAPTION_LANGUAGE_OPTIONS.find((option) => option.value === captionLanguage)?.name ??
    'the original language'

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
          <View className="flex-row items-center justify-between">
            <Text className="font-heading text-xl text-text-primary">Playback</Text>
            <Pressable
              accessibilityLabel="Close playback options"
              accessibilityRole="button"
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-muted"
              hitSlop={4}
              onPress={() => sheetRef.current?.dismiss()}
            >
              <MaterialIcons name="close" size={20} color={colors.text.primary} />
            </Pressable>
          </View>

          <Text className="font-sans mb-2 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Captions
          </Text>
          <View className="rounded-[24px] bg-surface-muted p-4">
            <Pressable
              accessibilityHint="Turns synchronized reel captions on or off"
              accessibilityLabel="Live transcription"
              accessibilityRole="button"
              accessibilityState={{ selected: transcriptionEnabled }}
              className="flex-row items-center"
              onPress={() => onTranscriptionChange(!transcriptionEnabled)}
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-soft">
                <MaterialIcons name="subtitles" size={20} color={colors.brand.primary} />
              </View>
              <View className="ml-3 flex-1 pr-3">
                <Text className="font-medium text-md text-text-primary">Live transcription</Text>
                <Text className="font-sans mt-0.5 text-sm2 text-text-secondary">
                  {transcriptionEnabled
                    ? 'Captions are on · tap to turn off'
                    : 'Captions are off · tap to turn on'}
                </Text>
              </View>
              <View
                className={
                  transcriptionEnabled
                    ? 'h-7 w-12 justify-center rounded-full bg-brand px-1 items-end'
                    : 'h-7 w-12 justify-center rounded-full bg-border-strong px-1 items-start'
                }
              >
                <View className="h-5 w-5 rounded-full bg-white" />
              </View>
            </Pressable>

            {transcriptionEnabled ? (
              <View className="mt-4 border-t border-border-default pt-4">
                <Text className="font-medium mb-2 text-sm2 text-text-secondary">
                  Caption language
                </Text>
                <View className="flex-row rounded-full bg-white p-1">
                  {CAPTION_LANGUAGE_OPTIONS.map((option) => {
                    const selected = captionLanguage === option.value
                    const translating = selected && captionLanguageStatus === 'loading'

                    return (
                      <Pressable
                        key={option.value}
                        accessibilityLabel={`${option.label} captions`}
                        accessibilityHint={
                          option.value === 'original'
                            ? 'Shows captions in the language spoken in the reel'
                            : `Translates captions into ${option.name}`
                        }
                        accessibilityRole="button"
                        accessibilityState={{ selected, busy: translating }}
                        className={
                          selected
                            ? 'h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-brand'
                            : 'h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-full'
                        }
                        onPress={() => onCaptionLanguageChange(option.value)}
                      >
                        {translating ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                        <Text
                          className={
                            selected
                              ? 'font-semibold text-base2 text-white'
                              : 'font-medium text-base2 text-text-secondary'
                          }
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>

                {captionLanguageStatus === 'loading' ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    className="font-sans mt-3 text-sm2 text-text-secondary"
                  >
                    Translating to {selectedLanguageName}… original captions keep showing until it
                    is ready.
                  </Text>
                ) : null}
                {captionLanguageStatus === 'error' ? (
                  <View className="mt-3 flex-row items-center justify-between">
                    <Text
                      accessibilityLiveRegion="polite"
                      className="font-sans flex-1 pr-3 text-sm2 text-text-secondary"
                    >
                      Couldn’t translate this reel. Showing original captions.
                    </Text>
                    {onRetryCaptionLanguage ? (
                      <Pressable
                        accessibilityLabel="Retry translation"
                        accessibilityRole="button"
                        className="h-9 items-center justify-center rounded-full bg-brand-soft px-4"
                        onPress={onRetryCaptionLanguage}
                      >
                        <Text className="font-semibold text-sm2 text-brand-text">Retry</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          <Text className="font-sans mb-2 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Display
          </Text>
          <Pressable
            accessibilityHint="Hides reel controls and text so only the video remains visible"
            accessibilityLabel="Clear display"
            accessibilityRole="button"
            className="flex-row items-center rounded-[24px] bg-surface-muted p-4"
            onPress={handleClearDisplay}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-white">
              <MaterialIcons name="visibility-off" size={20} color={colors.text.primary} />
            </View>
            <View className="ml-3 flex-1 pr-3">
              <Text className="font-medium text-md text-text-primary">Clear display</Text>
              <Text className="font-sans mt-0.5 text-sm2 text-text-secondary">
                Hide controls and text, just the video
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color={colors.text.tertiary} />
          </Pressable>

          <Text className="font-sans mb-2 mt-5 text-xs2 uppercase tracking-[1.1px] text-text-muted">
            Playback speed
          </Text>
          <View className="flex-row rounded-full bg-surface-muted p-1">
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
                      ? 'h-10 flex-1 items-center justify-center rounded-full bg-brand'
                      : 'h-10 flex-1 items-center justify-center rounded-full'
                  }
                  onPress={() => onPlaybackSpeedChange(speed)}
                >
                  <Text
                    className={
                      selected
                        ? 'font-semibold text-base2 text-white'
                        : 'font-medium text-base2 text-text-secondary'
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
