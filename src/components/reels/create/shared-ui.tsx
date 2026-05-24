import { MaterialIcons } from '@expo/vector-icons'
import { BlurView } from 'expo-blur'
import React from 'react'
import { Switch, Text, TouchableOpacity, View } from 'react-native'
import Animated, { FadeIn } from 'react-native-reanimated'

import type { ActionConfig, ImportState, MaterialIconName } from '../../../types/reel-creator'

type IconButtonTone = 'camera' | 'light' | 'video'

export function GlassIconButton({
  icon,
  onPress,
  active = false,
  tone = 'camera',
}: {
  icon: MaterialIconName
  onPress: () => void
  active?: boolean
  tone?: IconButtonTone
}) {
  const isLight = tone === 'light'
  const isVideo = tone === 'video'
  const backgroundColor = active
    ? '#FF7A45'
    : isLight
      ? '#FFFFFF'
      : isVideo
        ? 'rgba(255,255,255,0.92)'
        : 'rgba(255,255,255,0.18)'
  const borderColor = active
    ? '#FF7A45'
    : isLight
      ? '#E9DDD2'
      : isVideo
        ? 'rgba(0,0,0,0.08)'
        : 'rgba(255,255,255,0.22)'
  const iconColor = active ? '#FFFFFF' : isLight || isVideo ? '#171717' : '#FFFFFF'

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
      <View
        className="h-12 min-w-12 items-center justify-center rounded-full border px-3.5"
        style={{
          backgroundColor,
          borderColor,
          shadowColor: isLight ? 'rgba(86, 58, 35, 0.12)' : 'rgba(0, 0, 0, 0.16)',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 1,
          shadowRadius: 18,
          elevation: isLight ? 3 : 0,
        }}
      >
        <MaterialIcons name={icon} size={22} color={iconColor} />
      </View>
    </TouchableOpacity>
  )
}

export function SegmentedPill({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      className={`rounded-full px-4 py-2.5 ${active ? 'bg-white' : 'bg-white/10'}`}
      activeOpacity={0.84}
      onPress={onPress}
    >
      <Text
        className="text-sm2 font-medium"
        style={{ color: active ? '#111111' : 'rgba(255,255,255,0.86)' }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
}

export function ToolRailButton({
  icon,
  label,
  active,
  onPress,
}: ActionConfig & {
  active: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity className="items-center" activeOpacity={0.84} onPress={onPress}>
      <BlurView
        intensity={28}
        tint="dark"
        className={`h-14 w-14 items-center justify-center rounded-[20px] border ${
          active ? 'border-brand bg-brand/20' : 'border-white/12 bg-black/22'
        }`}
      >
        <MaterialIcons name={icon} size={22} color="#FFFFFF" />
      </BlurView>
      <Text className={`mt-2 text-xs2 ${active ? 'text-white' : 'text-white/64'}`}>{label}</Text>
    </TouchableOpacity>
  )
}

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <BlurView
      intensity={24}
      tint="dark"
      className="overflow-hidden rounded-[30px] border border-white/10"
    >
      <View className="px-5 py-5">
        <Text className="font-heading text-lg text-white">{title}</Text>
        {subtitle ? <Text className="mt-1 text-sm2 text-white/58">{subtitle}</Text> : null}
        <View className="mt-4">{children}</View>
      </View>
    </BlurView>
  )
}

export function MetadataRow({
  icon,
  title,
  value,
  onPress,
}: {
  icon: MaterialIconName
  title: string
  value: string
  onPress?: () => void
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center justify-between rounded-[22px] bg-white/6 px-4 py-4"
      activeOpacity={onPress ? 0.84 : 1}
      onPress={onPress}
      disabled={!onPress}
    >
      <View className="flex-row items-center">
        <View className="h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <MaterialIcons name={icon} size={20} color="#FFFFFF" />
        </View>
        <Text className="ml-3 text-base2 text-white">{title}</Text>
      </View>
      <View className="max-w-[54%] flex-row items-center">
        <Text className="text-right text-sm2 text-white/64" numberOfLines={1}>
          {value}
        </Text>
        {onPress ? (
          <MaterialIcons name="chevron-right" size={18} color="rgba(255,255,255,0.54)" />
        ) : null}
      </View>
    </TouchableOpacity>
  )
}

export function ToggleRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
}: {
  icon: MaterialIconName
  title: string
  subtitle: string
  value: boolean
  onValueChange: (nextValue: boolean) => void
}) {
  return (
    <View className="flex-row items-center justify-between rounded-[22px] bg-white/6 px-4 py-4">
      <View className="mr-4 flex-1 flex-row items-start">
        <View className="mt-1 h-10 w-10 items-center justify-center rounded-full bg-white/10">
          <MaterialIcons name={icon} size={20} color="#FFFFFF" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base2 text-white">{title}</Text>
          <Text className="mt-1 text-sm2 leading-5 text-white/56">{subtitle}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        thumbColor="#FFFFFF"
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: 'rgba(255,107,44,0.72)' }}
      />
    </View>
  )
}

export function ImportOverlay({ importState }: { importState: ImportState }) {
  if (!importState.active) {
    return null
  }

  return (
    <Animated.View
      className="absolute inset-0 items-center justify-center bg-black/68 px-8"
      entering={FadeIn.duration(120)}
      pointerEvents="none"
    >
      <View className="w-full max-w-[280px] rounded-[28px] bg-white px-6 py-5">
        <Text className="text-center font-heading text-xl" style={{ color: '#17120F' }}>
          {importState.label}
        </Text>
        <View className="mt-4 h-2 overflow-hidden rounded-full bg-[#F7F2EC]">
          <View
            className="h-full rounded-full bg-[#FF7A45]"
            style={{ width: `${Math.max(12, importState.progress * 100)}%` }}
          />
        </View>
      </View>
    </Animated.View>
  )
}
