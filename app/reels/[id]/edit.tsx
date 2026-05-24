import { MaterialIcons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React, { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { GlassIconButton } from '@/components/reels/create/shared-ui'
import { MAX_CAPTION_LENGTH, bannedHashtags } from '@/constants/reel-creator'
import { useReelDetail, useUpdateReel } from '@/hooks/useReels'
import { extractHashtags, stripHashtagsFromCaption } from '@/lib/reels'

const buildCaptionValue = (description?: string, tags: string[] = []) => {
  const tagLine = tags
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(' ')

  return [description?.trim(), tagLine].filter(Boolean).join(' ')
}

export default function EditReelDetailsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string | string[] }>()
  const reelId = Array.isArray(id) ? id[0] : id
  const {
    data: reel,
    isPending,
    isError,
    error,
    refetch,
  } = useReelDetail(reelId, {
    enabled: Boolean(reelId),
  })
  const updateReel = useUpdateReel()
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')

  useEffect(() => {
    if (!reel) {
      return
    }

    setTitle(reel.title?.trim() ?? '')
    setCaption(buildCaptionValue(reel.description, reel.tags))
    setVisibility(reel.visibility)
  }, [reel])

  const extractedTags = useMemo(() => extractHashtags(caption), [caption])
  const hasChanges = Boolean(
    reel &&
    (title.trim() !== (reel.title?.trim() ?? '') ||
      caption.trim() !== buildCaptionValue(reel.description, reel.tags).trim() ||
      visibility !== reel.visibility),
  )

  const handleSave = async () => {
    if (!reelId || !reel) {
      return
    }

    const finalTitle = title.trim()

    if (!finalTitle && !caption.trim()) {
      Alert.alert('Details required', 'Add a title or caption before saving.')
      return
    }

    if (caption.length > MAX_CAPTION_LENGTH) {
      Alert.alert('Caption too long', `Keep your caption under ${MAX_CAPTION_LENGTH} characters.`)
      return
    }

    const blockedTags = extractedTags.filter((tag) => bannedHashtags.includes(tag))

    if (blockedTags.length > 0) {
      Alert.alert(
        'Banned hashtags',
        `Remove these hashtags before saving: ${blockedTags.join(', ')}`,
      )
      return
    }

    try {
      await updateReel.mutateAsync({
        id: reelId,
        data: {
          title: finalTitle || 'Untitled reel',
          description: stripHashtagsFromCaption(caption),
          tags: extractedTags,
          visibility,
        },
      })
      router.back()
    } catch (saveError) {
      const message =
        (saveError as (Error & { response?: { data?: { message?: string } } }) | null)?.response
          ?.data?.message ||
        (saveError as Error | null)?.message ||
        'Velora could not update this reel.'

      Alert.alert('Save failed', message)
    }
  }

  const errorMessage =
    (error as (Error & { response?: { data?: { message?: string } } }) | null)?.response?.data
      ?.message ||
    (error as Error | null)?.message ||
    'Could not load this reel.'

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F7F2EC]">
        <StatusBar style="dark" />
        <ActivityIndicator color="#FF7A45" />
      </View>
    )
  }

  if (isError || !reel) {
    return (
      <View className="flex-1 items-center justify-center bg-[#F7F2EC] px-6">
        <StatusBar style="dark" />
        <View className="items-center rounded-[28px] bg-white px-6 py-7">
          <MaterialIcons name="error-outline" size={32} color="#D85A21" />
          <Text className="mt-4 font-heading text-xl" style={{ color: '#17120F' }}>
            Reel unavailable
          </Text>
          <Text className="mt-2 text-center text-base2" style={{ color: 'rgba(46,36,30,0.62)' }}>
            {errorMessage}
          </Text>
          <TouchableOpacity
            className="mt-6 rounded-full bg-[#FF7A45] px-5 py-3"
            activeOpacity={0.84}
            onPress={() => {
              void refetch()
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-[#F7F2EC]"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="dark" />
      <View
        className="flex-1 px-5"
        style={{
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom + 12, 12),
        }}
      >
        <View className="min-h-[56px] justify-center">
          <View className="absolute left-0 z-10">
            <GlassIconButton icon="arrow-back" tone="light" onPress={router.back} />
          </View>

          <View className="absolute left-16 right-24 items-center">
            <Text
              className="text-xs2 uppercase tracking-[1.2px]"
              style={{ color: 'rgba(46,36,30,0.58)' }}
            >
              Edit
            </Text>
            <Text className="mt-1 font-heading text-[22px]" style={{ color: '#17120F' }}>
              Reel details
            </Text>
          </View>

          <TouchableOpacity
            className={`absolute right-0 rounded-full px-5 py-3 ${
              hasChanges && !updateReel.isPending ? 'bg-[#FF7A45]' : 'bg-[#E9DDD2]'
            }`}
            activeOpacity={0.84}
            disabled={!hasChanges || updateReel.isPending}
            onPress={() => {
              void handleSave()
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>
              {updateReel.isPending ? 'Saving' : 'Save'}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          className="mt-3 flex-1"
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="rounded-[28px] bg-white p-3">
            <View className="flex-row items-center">
              <View className="overflow-hidden rounded-[18px] border border-[#E9DED5] bg-[#F7F2EC]">
                {reel.thumbnailUrl ? (
                  <Image
                    source={{ uri: reel.thumbnailUrl }}
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
                  {reel.status === 'COMPLETED' ? 'Ready reel' : reel.status}
                </Text>
                <Text
                  className="mt-1 text-xs2 leading-4"
                  style={{ color: 'rgba(46,36,30,0.62)' }}
                  numberOfLines={2}
                >
                  Update title, caption, hashtags, and visibility.
                </Text>
              </View>
            </View>
          </View>

          <View className="mt-3 rounded-[28px] bg-white px-4 py-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
                Details
              </Text>
              <Text style={{ color: 'rgba(46,36,30,0.48)', fontSize: 12 }}>
                {caption.length}/{MAX_CAPTION_LENGTH}
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
                value={title}
                onChangeText={setTitle}
                editable={!updateReel.isPending}
                selectionColor="#FF7A45"
              />
            </View>

            <View className="mt-3 min-h-[180px] rounded-[22px] bg-[#F7F2EC] px-4 py-3">
              <Text style={{ color: 'rgba(46,36,30,0.66)', fontSize: 12, fontWeight: '800' }}>
                Caption
              </Text>
              <TextInput
                className="mt-2 min-h-[136px] text-base2"
                style={{ color: '#17120F', padding: 0 }}
                placeholder="Write a caption and add hashtags like #velora"
                placeholderTextColor="rgba(46,36,30,0.38)"
                multiline
                value={caption}
                onChangeText={setCaption}
                editable={!updateReel.isPending}
                selectionColor="#FF7A45"
                textAlignVertical="top"
              />
            </View>
          </View>

          <View className="mt-3 rounded-[28px] bg-white px-4 py-4">
            <Text className="font-heading text-lg" style={{ color: '#17120F' }}>
              Visibility
            </Text>
            <View className="mt-3 flex-row gap-2">
              {(['public', 'private'] as const).map((option) => (
                <TouchableOpacity
                  key={option}
                  className={`flex-1 rounded-full px-4 py-3 ${
                    visibility === option ? 'bg-[#FF7A45]' : 'bg-[#F7F2EC]'
                  }`}
                  activeOpacity={0.84}
                  onPress={() => {
                    setVisibility(option)
                  }}
                >
                  <Text
                    className="text-center capitalize"
                    style={{
                      color: visibility === option ? '#FFFFFF' : '#17120F',
                      fontWeight: '800',
                    }}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
