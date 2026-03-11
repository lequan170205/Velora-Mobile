export const colors = {
  // Backgrounds
  bg: {
    primary: '#0A0A0F', // Near black
    secondary: '#111118',
    elevated: '#1A1A24',
    glass: 'rgba(255,255,255,0.04)',
    glassBorder: 'rgba(255,255,255,0.08)',
  },
  // Brand
  brand: {
    primary: '#6C63FF', // Electric violet
    secondary: '#4ECDC4', // Teal accent
    tertiary: '#FF6B6B', // Coral
    gradient: ['#6C63FF', '#4ECDC4'],
  },
  // Text
  text: {
    primary: '#F2F2F7',
    secondary: '#8E8EA0',
    tertiary: '#48485E',
    inverse: '#0A0A0F',
  },
  // Status
  status: {
    online: '#34D399',
    away: '#FBBF24',
    offline: '#6B7280',
    error: '#FF6B6B',
    success: '#34D399',
  },
  // Semantic
  surface: {
    card: '#1A1A24',
    input: '#13131C',
    modal: '#1E1E2C',
  },
  // Messages
  bubble: {
    outgoing: '#6C63FF',
    incoming: '#1E1E2C',
    outgoingText: '#FFFFFF',
    incomingText: '#F2F2F7',
  },
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
  bubble: { outgoing: [20, 20, 4, 20], incoming: [20, 20, 20, 4] },
}

export const typography = {
  // Use Expo Google Fonts: @expo-google-fonts/inter + @expo-google-fonts/space-grotesk
  fonts: {
    display: 'SpaceGrotesk_700Bold',
    heading: 'SpaceGrotesk_600SemiBold',
    body: 'Inter_400Regular',
    bodyMedium: 'Inter_500Medium',
    mono: 'SpaceMono_400Regular',
  },
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 16,
    lg: 18,
    xl: 22,
    xxl: 28,
    display: 34,
  },
}

export const shadows = {
  sm: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  md: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  glow: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
}
