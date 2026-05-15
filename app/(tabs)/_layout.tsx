import { MaterialIcons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import React from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export default function TabLayout() {
  const insets = useSafeAreaInsets()
  const isIos = process.env.EXPO_OS === 'ios'
  const bottomPadding = isIos ? Math.max(insets.bottom, 8) : Math.max(insets.bottom, 18)
  const tabBarHeight = (isIos ? 54 : 58) + bottomPadding
  const baseTabBarStyle = {
    height: tabBarHeight,
    paddingTop: isIos ? 8 : 10,
    paddingBottom: bottomPadding,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#ECECEC',
    elevation: 0,
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
  }
  const reelsTabBarStyle = {
    ...baseTabBarStyle,
    backgroundColor: '#050505',
    borderTopColor: 'rgba(255,255,255,0.08)',
    shadowOpacity: 0,
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        freezeOnBlur: true,
        tabBarStyle: baseTabBarStyle,
        tabBarActiveTintColor: '#FF6B2C',
        tabBarInactiveTintColor: '#8A8A8A',
        tabBarLabelStyle: {
          display: 'none',
        },
        tabBarItemStyle: {
          paddingTop: 4,
          paddingBottom: isIos ? 4 : 8,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color, size: _size }) => (
            <MaterialIcons name="chat-bubble-outline" size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'People',
          tabBarIcon: ({ color, size: _size }) => (
            <MaterialIcons name="people-outline" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="reels"
        options={{
          title: 'Reels',
          tabBarStyle: reelsTabBarStyle,
          tabBarActiveTintColor: '#FFFFFF',
          tabBarInactiveTintColor: 'rgba(255,255,255,0.6)',
          tabBarIcon: ({ color, size: _size }) => (
            <MaterialIcons name="play-circle-outline" size={28} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: 'Calls',
          tabBarIcon: ({ color, size: _size }) => (
            <MaterialIcons name="call" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size: _size }) => (
            <MaterialIcons name="person-outline" size={26} color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
