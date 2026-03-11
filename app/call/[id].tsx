import { MaterialIcons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function ActiveCallScreen() {
  const { type } = useLocalSearchParams<{ id: string; type: string }>()
  const router = useRouter()
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setDuration((d) => d + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleEndCall = () => {
    router.back()
  }

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s < 10 ? '0' : ''}${s}`
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <MaterialIcons name="keyboard-arrow-down" size={28} color="#f8fafc" />
          </TouchableOpacity>
          <View style={styles.secureHeader}>
            <MaterialIcons name="lock" size={14} color="#94a3b8" />
            <Text style={styles.headerTitle}>End-to-End Encrypted</Text>
          </View>
          <View style={{ width: 48 }} />
        </View>

        <View style={styles.mainContent}>
          {type === 'VIDEO' ? (
            <View style={styles.videoPlaceholder}>
              <Text style={styles.videoText}>Remote Video Stream</Text>

              <View style={styles.localVideoPip}>
                <Text style={styles.localVideoText}>Local</Text>
              </View>
            </View>
          ) : (
            <View style={styles.audioPlaceholder}>
              <View style={styles.avatarContainer}>
                <View style={styles.avatarSolid}>
                  <Text style={styles.avatarText}>U</Text>
                </View>
              </View>

              <Text style={styles.callerName}>User Name</Text>
              <Text style={styles.durationText}>{formatDuration(duration)}</Text>
            </View>
          )}
        </View>

        <View style={styles.controlsWrapper}>
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.controlBtn}>
              <MaterialIcons name="mic-off" size={28} color="#f8fafc" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn}>
              <MaterialIcons name="videocam" size={28} color="#f8fafc" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.controlBtn}>
              <MaterialIcons name="volume-up" size={28} color="#f8fafc" />
            </TouchableOpacity>
          </View>

          <View style={styles.endCallContainer}>
            <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall}>
              <MaterialIcons name="call-end" size={36} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </View>
  )
}

const styles = StyleSheet.create({
  audioPlaceholder: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  avatarContainer: {
    alignItems: 'center',
    height: 160,
    justifyContent: 'center',
    marginBottom: 40,
    width: 160,
  },
  avatarSolid: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 80,
    height: 160,
    justifyContent: 'center',
    width: 160,
  },
  avatarText: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 64,
  },
  backButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  callerName: {
    color: '#f8fafc',
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  container: {
    backgroundColor: '#121212',
    flex: 1,
  },
  controlBtn: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    width: '100%',
  },
  controlsWrapper: {
    paddingBottom: 48,
    paddingTop: 32,
    width: '100%',
  },
  durationText: {
    color: '#94a3b8',
    fontFamily: 'Inter_500Medium',
    fontSize: 18,
  },
  endCallBtn: {
    alignItems: 'center',
    backgroundColor: '#ef4444',
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  endCallContainer: {
    alignItems: 'center',
    marginTop: 40,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    zIndex: 10,
  },
  headerTitle: {
    color: '#94a3b8',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginLeft: 4,
  },
  localVideoPip: {
    alignItems: 'center',
    backgroundColor: '#1E1E24',
    borderRadius: 16,
    bottom: 24,
    height: 160,
    justifyContent: 'center',
    position: 'absolute',
    right: 24,
    width: 110,
  },
  localVideoText: {
    color: '#94a3b8',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  mainContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
    zIndex: 10,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  secureHeader: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  videoPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
  },
  videoText: {
    color: '#64748b',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
})
