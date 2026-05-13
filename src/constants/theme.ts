export const colors = {
  // Backgrounds — Light, clean white
  bg: {
    primary: '#FFFFFF',
    secondary: '#F2F2F7',
    elevated: '#FFFFFF',
    glass: 'rgba(0,0,0,0.02)',
    glassBorder: 'rgba(0,0,0,0.06)',
  },
  // Brand — Warm Orange
  brand: {
    primary: '#FF6B2C',
    secondary: '#FF8F5C',
    tertiary: '#E55A1B',
    gradient: ['#FF6B2C', '#FF8F5C'],
  },
  // Text — Dark on light
  text: {
    primary: '#1C1C1E',
    secondary: '#8E8E93',
    tertiary: '#AEAEB2',
    inverse: '#FFFFFF',
  },
  // Status
  status: {
    online: '#34C759',
    away: '#FF9500',
    offline: '#8E8E93',
    error: '#FF3B30',
    success: '#34C759',
  },
  // Semantic
  surface: {
    card: '#F2F2F7',
    input: '#F8F8F8',
    modal: '#FFFFFF',
  },
  // Messages
  bubble: {
    outgoing: '#FF6B2C',
    incoming: '#F2F2F7',
    outgoingText: '#FFFFFF',
    incomingText: '#1C1C1E',
  },
  // Borders
  border: {
    default: '#E5E5EA',
    light: '#F2F2F7',
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
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: '#FF6B2C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
}
