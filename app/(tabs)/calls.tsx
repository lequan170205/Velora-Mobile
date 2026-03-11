import { MaterialIcons } from '@expo/vector-icons'
import { FlashList as OriginalFlashList } from '@shopify/flash-list'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FlashList = OriginalFlashList as any

const MOCK_CALLS = [
  {
    id: '1',
    name: 'Alice Johnson',
    type: 'VIDEO',
    direction: 'INCOMING',
    date: 'Today, 2:30 PM',
    duration: '5m 20s',
  },
  {
    id: '2',
    name: 'Bob Smith',
    type: 'VOICE',
    direction: 'OUTGOING',
    date: 'Yesterday, 9:15 AM',
    duration: '12m 0s',
  },
  {
    id: '3',
    name: 'Charlie Davis',
    type: 'VIDEO',
    direction: 'MISSED',
    date: 'Monday',
    duration: 'Missed',
  },
]

export default function CallsScreen() {
  const renderItem = ({ item }: { item: (typeof MOCK_CALLS)[0] }) => {
    const isMissed = item.direction === 'MISSED'

    let iconName: keyof typeof MaterialIcons.glyphMap = 'call-received'
    let iconColor = '#94a3b8'
    if (isMissed) {
      iconName = 'call-missed'
      iconColor = '#ef4444'
    } else if (item.direction === 'OUTGOING') {
      iconName = 'call-made'
      iconColor = '#94a3b8'
    } else if (item.direction === 'INCOMING') {
      iconName = 'call-received'
      iconColor = '#94a3b8'
    }

    const typeIconName: keyof typeof MaterialIcons.glyphMap =
      item.type === 'VIDEO' ? 'videocam' : 'call'

    return (
      <View style={styles.callItemWrapper}>
        <View style={styles.callItem}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarSolid}>
              <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
            </View>
          </View>

          <View style={styles.info}>
            <Text style={[styles.name, isMissed && styles.nameMissed]} numberOfLines={1}>
              {item.name}
            </Text>

            <View style={styles.detailsRow}>
              <MaterialIcons
                name={iconName}
                size={16}
                color={iconColor}
                style={styles.directionIcon}
              />
              <Text style={styles.detailsText}>{item.type === 'VIDEO' ? 'Video' : 'Audio'}</Text>
            </View>
          </View>

          <View style={styles.rightContent}>
            <Text style={styles.dateText}>{item.date}</Text>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name={typeIconName} size={24} color="#f8fafc" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Calls</Text>
      </View>

      <View style={styles.listContainer}>
        <FlashList
          data={MOCK_CALLS}
          renderItem={renderItem}
          keyExtractor={(item: (typeof MOCK_CALLS)[0]) => item.id}
          estimatedItemSize={90}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No recent calls.</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginTop: 6,
    width: 40,
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatarSolid: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  avatarText: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  callItem: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: 12,
  },
  callItemWrapper: {
    marginHorizontal: 20,
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  dateText: {
    color: '#64748b',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  detailsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 4,
  },
  detailsText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  directionIcon: {
    marginRight: 4,
  },
  empty: {
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    color: '#94a3b8',
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    zIndex: 10,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  listContainer: {
    flex: 1,
    zIndex: 10,
  },
  name: {
    color: '#f8fafc',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  nameMissed: {
    color: '#ef4444',
  },
  rightContent: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  title: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
  },
})
