import { MaterialIcons } from '@expo/vector-icons'
import React from 'react'
import { Text, View } from 'react-native'
import { Pressable } from 'react-native-gesture-handler'

import type { MaterialIconName } from '../../../types/reel-creator'

type EditorToolbarActionProps = {
  active?: boolean
  icon: MaterialIconName
  label: string
  onPress: () => void
}

function EditorToolbarAction({ active = false, icon, label, onPress }: EditorToolbarActionProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          backgroundColor: active ? '#17120F' : '#F7F2EC',
          borderRadius: 18,
          flex: 1,
          justifyContent: 'center',
          minHeight: 48,
          paddingHorizontal: 8,
        },
        { opacity: pressed ? 0.76 : 1 },
      ]}
    >
      <View className="flex-row items-center">
        <MaterialIcons name={icon} size={17} color={active ? '#FFFFFF' : '#17120F'} />
        <Text
          className="ml-1.5 text-xs2"
          style={{ color: active ? '#FFFFFF' : '#17120F', fontWeight: '800' }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

export function EditorToolbar({
  isCropActive,
  isTrimActive,
  onCrop,
  onTrim,
}: {
  isCropActive: boolean
  isTrimActive: boolean
  onCrop: () => void
  onTrim: () => void
}) {
  return (
    <View className="mt-3 flex-row gap-2 rounded-[22px] border border-[#E6DAD0] bg-white p-2">
      <EditorToolbarAction active={isTrimActive} icon="content-cut" label="Trim" onPress={onTrim} />
      <EditorToolbarAction
        active={isCropActive}
        icon="crop"
        label={isCropActive ? 'Crop ✓' : 'Crop'}
        onPress={onCrop}
      />
    </View>
  )
}
