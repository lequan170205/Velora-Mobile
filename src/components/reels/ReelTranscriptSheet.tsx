import { MaterialIcons } from '@expo/vector-icons'
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { ReelSection, ReelTranscriptSegment } from '../../types/reel.types'

type TranscriptSheetTab = 'chapters' | 'transcript'

interface ReelTranscriptSheetProps {
  visible: boolean
  reelTitle?: string | undefined
  currentTime: number
  transcript?: string | undefined
  transcriptSegments?: ReelTranscriptSegment[] | undefined
  sections?: ReelSection[] | undefined
  isLoading?: boolean | undefined
  hasError?: boolean | undefined
  onClose: () => void
  onSeek: (seconds: number) => void
}

const formatTimestamp = (value: number) => {
  const safeValue = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const hours = Math.floor(safeValue / 3600)
  const minutes = Math.floor((safeValue % 3600) / 60)
  const seconds = safeValue % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const getChapterLabel = (section: ReelSection, index: number) =>
  section.title?.trim() || `Chapter ${section.ordinal + 1 || index + 1}`

export function ReelTranscriptSheet({
  visible,
  reelTitle,
  currentTime,
  transcript,
  transcriptSegments = [],
  sections = [],
  isLoading = false,
  hasError = false,
  onClose,
  onSeek,
}: ReelTranscriptSheetProps) {
  const insets = useSafeAreaInsets()
  const hasChapters = sections.length > 0
  const hasTimedTranscript = transcriptSegments.length > 0
  const hasTranscript = hasTimedTranscript || Boolean(transcript?.trim())
  const [activeTab, setActiveTab] = useState<TranscriptSheetTab>(
    hasChapters ? 'chapters' : 'transcript',
  )

  useEffect(() => {
    if (!visible) {
      return
    }

    setActiveTab(hasChapters ? 'chapters' : 'transcript')
  }, [hasChapters, visible])

  const activeTranscriptIndex = useMemo(() => {
    if (!hasTimedTranscript) {
      return -1
    }

    return transcriptSegments.findIndex((segment, index) => {
      const nextSegment = transcriptSegments[index + 1]
      const segmentEnd =
        Number.isFinite(segment.end) && segment.end > segment.start
          ? segment.end
          : nextSegment?.start ?? Number.POSITIVE_INFINITY

      return currentTime >= segment.start && currentTime < segmentEnd
    })
  }, [currentTime, hasTimedTranscript, transcriptSegments])

  const activeChapterIndex = useMemo(() => {
    if (!hasChapters) {
      return -1
    }

    return sections.findIndex((section, index) => {
      const nextSection = sections[index + 1]
      const sectionEnd =
        Number.isFinite(section.endTime) && section.endTime > section.startTime
          ? section.endTime
          : nextSection?.startTime ?? Number.POSITIVE_INFINITY

      return currentTime >= section.startTime && currentTime < sectionEnd
    })
  }, [currentTime, hasChapters, sections])

  const renderEmptyState = () => (
    <View className="items-center px-8 py-14">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-surface-muted">
        <MaterialIcons
          name={hasError ? 'error-outline' : 'subtitles-off'}
          size={25}
          color="#8B8683"
        />
      </View>
      <Text className="mt-4 text-center font-heading text-lg text-text-primary">
        {hasError ? 'Couldn’t load transcript' : 'No transcript available'}
      </Text>
      <Text className="mt-2 text-center text-sm2 leading-5 text-text-secondary">
        {hasError
          ? 'Please try again in a moment.'
          : 'A transcript isn’t available for this reel.'}
      </Text>
    </View>
  )

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFillObject} className="justify-end">
        <Pressable
          accessibilityLabel="Close transcript"
          accessibilityRole="button"
          onPress={onClose}
          style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(8, 8, 10, 0.5)' }]}
        />

        <View
          className="rounded-t-[32px] bg-white px-5 pt-3"
          style={{
            maxHeight: '82%',
            minHeight: 360,
            paddingBottom: Math.max(insets.bottom, 18),
            shadowColor: 'rgba(22, 22, 22, 0.2)',
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 1,
            shadowRadius: 24,
            elevation: 18,
          }}
        >
          <View className="items-center pb-2">
            <View className="h-1.5 w-14 rounded-full bg-[#D9D9D9]" />
          </View>

          <View className="mt-3 flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="font-heading text-xl text-text-primary">Transcript</Text>
              <Text className="mt-1 text-base2 text-text-secondary" numberOfLines={1}>
                {reelTitle?.trim() || 'Follow along'}
              </Text>
            </View>

            <TouchableOpacity
              accessibilityLabel="Close transcript"
              accessibilityRole="button"
              className="h-11 w-11 items-center justify-center rounded-full bg-surface-muted"
              activeOpacity={0.84}
              onPress={onClose}
            >
              <MaterialIcons name="close" size={20} color="#161616" />
            </TouchableOpacity>
          </View>

          {hasChapters ? (
            <View className="mt-5 flex-row rounded-[20px] bg-surface-muted p-1">
              <TouchableOpacity
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'chapters' }}
                className={`flex-1 items-center rounded-[16px] px-3 py-2.5 ${
                  activeTab === 'chapters' ? 'bg-white' : ''
                }`}
                activeOpacity={0.84}
                onPress={() => setActiveTab('chapters')}
              >
                <Text
                  className={`text-sm2 font-medium ${
                    activeTab === 'chapters' ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  Chapters
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="tab"
                accessibilityState={{ selected: activeTab === 'transcript' }}
                className={`flex-1 items-center rounded-[16px] px-3 py-2.5 ${
                  activeTab === 'transcript' ? 'bg-white' : ''
                }`}
                activeOpacity={0.84}
                onPress={() => setActiveTab('transcript')}
              >
                <Text
                  className={`text-sm2 font-medium ${
                    activeTab === 'transcript' ? 'text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  Transcript
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View className="mt-4 flex-1">
            {isLoading ? (
              <View className="flex-1 items-center justify-center py-14">
                <ActivityIndicator color="#FF6B2C" size="small" />
                <Text className="mt-3 text-sm2 text-text-secondary">Loading transcript…</Text>
              </View>
            ) : activeTab === 'chapters' && hasChapters ? (
              <FlatList
                data={sections}
                keyExtractor={(section, index) => section.id || `section-${index}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
                renderItem={({ item: section, index }) => {
                  const isActive = index === activeChapterIndex
                  const summary = section.derivedSummary?.trim() || section.description?.trim()

                  return (
                    <TouchableOpacity
                      accessibilityLabel={`Jump to ${getChapterLabel(section, index)} at ${formatTimestamp(
                        section.startTime,
                      )}`}
                      accessibilityRole="button"
                      className={`mb-2 rounded-[22px] px-4 py-4 ${
                        isActive ? 'bg-[#FFF5F0]' : 'bg-surface-muted'
                      }`}
                      activeOpacity={0.84}
                      onPress={() => onSeek(section.startTime)}
                    >
                      <View className="flex-row items-start">
                        <View
                          className={`h-10 w-10 items-center justify-center rounded-full ${
                            isActive ? 'bg-[#FF6B2C]' : 'bg-white'
                          }`}
                        >
                          <MaterialIcons
                            name="play-arrow"
                            size={20}
                            color={isActive ? '#FFFFFF' : '#161616'}
                          />
                        </View>

                        <View className="ml-3 flex-1">
                          <View className="flex-row items-center justify-between gap-3">
                            <Text
                              className="flex-1 font-medium text-md text-text-primary"
                              numberOfLines={2}
                            >
                              {getChapterLabel(section, index)}
                            </Text>
                            <Text className="text-xs2 font-medium text-[#FF6B2C]">
                              {formatTimestamp(section.startTime)}
                            </Text>
                          </View>

                          {summary ? (
                            <Text
                              className="mt-1.5 text-sm2 leading-5 text-text-secondary"
                              numberOfLines={3}
                            >
                              {summary}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </TouchableOpacity>
                  )
                }}
              />
            ) : hasTimedTranscript ? (
              <FlatList
                data={transcriptSegments}
                keyExtractor={(segment, index) => `${segment.id ?? index}-${segment.start}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 8 }}
                renderItem={({ item: segment, index }) => {
                  const isActive = index === activeTranscriptIndex

                  return (
                    <TouchableOpacity
                      accessibilityLabel={`Jump to ${formatTimestamp(segment.start)}. ${segment.text}`}
                      accessibilityRole="button"
                      className={`mb-1.5 flex-row rounded-[18px] px-3 py-3 ${
                        isActive ? 'bg-[#F6F6F6]' : 'bg-transparent'
                      }`}
                      activeOpacity={0.76}
                      onPress={() => onSeek(segment.start)}
                    >
                      <Text
                        className={`w-14 pt-0.5 text-xs2 font-medium ${
                          isActive ? 'text-[#FF6B2C]' : 'text-text-muted'
                        }`}
                      >
                        {formatTimestamp(segment.start)}
                      </Text>
                      <Text
                        className={`flex-1 text-sm2 leading-6 ${
                          isActive ? 'font-medium text-text-primary' : 'text-text-secondary'
                        }`}
                      >
                        {segment.text.trim()}
                      </Text>
                    </TouchableOpacity>
                  )
                }}
              />
            ) : hasTranscript ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View className="rounded-[22px] bg-surface-muted px-4 py-4">
                  <Text className="text-sm2 leading-6 text-text-secondary">{transcript?.trim()}</Text>
                </View>
              </ScrollView>
            ) : (
              renderEmptyState()
            )}
          </View>
        </View>
      </View>
    </Modal>
  )
}
