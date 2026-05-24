import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import React from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { MAX_CAPTION_LENGTH } from '../../../constants/reel-creator'

import { GlassIconButton } from './shared-ui'

import type { ReelCreatorController } from '../../../hooks/useReelCreator'
import type { ReelVisibility } from '../../../types/reel.types'

const visibilityOptions: {
  icon: keyof typeof MaterialIcons.glyphMap
  label: string
  value: ReelVisibility
}[] = [
  { icon: 'public', label: 'Public', value: 'public' },
  { icon: 'lock-outline', label: 'Private', value: 'private' },
]

export function PublishStage({ controller }: { controller: ReelCreatorController }) {
  const insets = useSafeAreaInsets()
  const draftButtonLabel =
    controller.draftSaveStatus === 'saving'
      ? 'Saving...'
      : controller.draftSaveStatus === 'saved'
        ? 'Saved'
        : 'Draft'

  if (!controller.selectedAsset) {
    return null
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#F7F2EC]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <Animated.View
        className="flex-1 bg-[#F7F2EC] px-5"
        entering={FadeIn.duration(180)}
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom + 12, 12),
        }}
      >
        <View className="min-h-[56px] justify-center">
          <View className="absolute left-0 z-10">
            <GlassIconButton icon="arrow-back" tone="light" onPress={controller.goToEditStage} />
          </View>

          <View className="absolute left-16 right-24 items-center">
            <Text
              className="text-xs2 uppercase tracking-[1.2px]"
              style={{ color: 'rgba(46,36,30,0.58)' }}
            >
              Publish
            </Text>
            <Text
              className="mt-1 font-heading text-[22px]"
              style={{ color: '#17120F' }}
              numberOfLines={1}
            >
              Finish reel
            </Text>
          </View>

          <TouchableOpacity
            className={`absolute right-0 rounded-full px-4 py-2.5 ${
              controller.draftSaveStatus === 'saved' ? 'bg-[#EAF8ED]' : 'bg-white'
            }`}
            activeOpacity={0.84}
            disabled={controller.draftSaveStatus === 'saving'}
            onPress={() => {
              void controller.handleSaveDraftManually()
            }}
            style={{
              shadowColor: 'rgba(86, 58, 35, 0.12)',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 1,
              shadowRadius: 18,
              elevation: 3,
            }}
          >
            <Text
              style={{
                color: controller.draftSaveStatus === 'saved' ? '#2C7A3F' : '#17120F',
                fontWeight: '800',
              }}
            >
              {draftButtonLabel}
            </Text>
          </TouchableOpacity>
        </View>

        <View className="mt-3 rounded-[28px] bg-white p-3">
          <View className="flex-row items-center">
            <View className="overflow-hidden rounded-[18px] border border-[#E9DED5] bg-[#F7F2EC]">
              {controller.thumbnailUri ? (
                <Image
                  source={{ uri: controller.thumbnailUri }}
                  contentFit="cover"
                  style={{ width: 58, height: 82 }}
                />
              ) : (
                <View className="h-[82px] w-[58px] items-center justify-center bg-[#F7F2EC]">
                  <MaterialIcons name="movie" size={20} color="#17120F" />
                </View>
              )}
            </View>

            <View className="ml-3 flex-1">
              <Text style={{ color: '#17120F', fontWeight: '800' }} numberOfLines={1}>
                Clip ready
              </Text>
              <Text
                className="mt-1 text-xs2 leading-4"
                style={{ color: 'rgba(46,36,30,0.62)' }}
                numberOfLines={2}
              >
                {controller.orientationMessage}
              </Text>
              <View className="mt-2 flex-row gap-2">
                <TouchableOpacity
                  className="rounded-full bg-[#F7F2EC] px-3 py-2"
                  activeOpacity={0.84}
                  onPress={controller.goToCaptureStage}
                >
                  <Text style={{ color: '#17120F', fontSize: 12, fontWeight: '800' }}>Replace</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="rounded-full bg-[#FFF0E8] px-3 py-2"
                  activeOpacity={0.84}
                  onPress={controller.handleDiscardDraft}
                >
                  <Text style={{ color: '#D85A21', fontSize: 12, fontWeight: '800' }}>Discard</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View className="mt-3 min-h-0 flex-1 rounded-[28px] bg-white px-4 py-4">
          <View className="flex-row items-center justify-between">
            <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
              Details
            </Text>
            <Text style={{ color: 'rgba(46,36,30,0.48)', fontSize: 12 }}>
              {controller.caption.length}/{MAX_CAPTION_LENGTH}
            </Text>
          </View>

          <View className="mt-3 rounded-[22px] bg-[#F7F2EC] px-4 py-3">
            <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
              Title
            </Text>
            <TextInput
              className="mt-1 text-base2"
              style={{ color: '#17120F', padding: 0 }}
              placeholder="Name this reel"
              placeholderTextColor="rgba(46,36,30,0.38)"
              value={controller.title}
              onChangeText={controller.setTitle}
              editable={!controller.isPending}
              selectionColor="#FF7A45"
            />
          </View>

          <View className="mt-3 min-h-0 flex-1 rounded-[22px] bg-[#F7F2EC] px-4 py-3">
            <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
              Caption
            </Text>
            <TextInput
              className="mt-2 min-h-0 flex-1 text-base2"
              style={{ color: '#17120F', padding: 0 }}
              placeholder="Write a caption and add hashtags like #velora"
              placeholderTextColor="rgba(46,36,30,0.38)"
              multiline
              scrollEnabled
              value={controller.caption}
              onChangeText={controller.setCaption}
              editable={!controller.isPending}
              selectionColor="#FF7A45"
              textAlignVertical="top"
            />
          </View>

          {controller.filteredComposerSuggestions.length > 0 ? (
            <View className="mt-3">
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
                  {controller.filteredComposerSuggestions.map((suggestion) => (
                    <TouchableOpacity
                      key={suggestion}
                      className="rounded-full bg-[#FFF0E8] px-3 py-2"
                      activeOpacity={0.84}
                      onPress={() => {
                        controller.handleInsertComposerSuggestion(suggestion)
                      }}
                    >
                      <Text style={{ color: '#D85A21', fontSize: 12, fontWeight: '800' }}>
                        {suggestion}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          <View className="mt-3">
            <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
              Visibility
            </Text>
            <View className="mt-2 flex-row gap-2">
              {visibilityOptions.map((option) => {
                const isActive = controller.visibility === option.value

                return (
                  <TouchableOpacity
                    key={option.value}
                    className={`flex-1 flex-row items-center justify-center rounded-full px-3 py-3 ${
                      isActive ? 'bg-[#17120F]' : 'bg-[#F7F2EC]'
                    }`}
                    activeOpacity={0.84}
                    disabled={controller.isPending}
                    onPress={() => {
                      controller.setVisibility(option.value)
                    }}
                  >
                    <MaterialIcons
                      name={option.icon}
                      size={17}
                      color={isActive ? '#FFFFFF' : '#17120F'}
                    />
                    <Text
                      className="ml-2"
                      style={{
                        color: isActive ? '#FFFFFF' : '#17120F',
                        fontSize: 13,
                        fontWeight: '800',
                      }}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </View>

        <TouchableOpacity
          className={`mt-3 rounded-[22px] px-5 py-4 ${
            controller.isPending ? 'bg-[#D9805A]' : 'bg-[#FF7A45]'
          }`}
          activeOpacity={0.84}
          disabled={controller.isPending}
          onPress={() => {
            void controller.handlePublish()
          }}
        >
          <Text className="text-center" style={{ color: '#FFFFFF', fontWeight: '800' }}>
            {controller.isPending ? controller.publishProgressLabel : 'Publish reel'}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </KeyboardAvoidingView>
  )
}
