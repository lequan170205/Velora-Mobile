export const colors = {
  // Backgrounds — Minimal neutral canvas
  bg: {
    primary: '#FFFFFF',
    secondary: '#F7F7F7',
    elevated: '#FFFFFF',
    glass: 'rgba(255,255,255,0.88)',
    glassBorder: 'rgba(17,17,17,0.05)',
  },
  // Brand — Clean orange accent
  brand: {
    primary: '#FF6B2C',
    secondary: '#FF935B',
    tertiary: '#D85A21',
    gradient: ['#FF6B2C', '#FF935B'],
  },
  // Text — Crisp neutral hierarchy
  text: {
    primary: '#161616',
    secondary: '#777777',
    tertiary: '#A6A6A6',
    inverse: '#FFFFFF',
  },
  // Status
  status: {
    online: '#34C759',
    away: '#FF9500',
    offline: '#B1B1B1',
    error: '#FF3B30',
    success: '#34C759',
  },
  // Calls — warm, media-first extension of the Velora brand
  call: {
    background: '#05090C',
    surface: '#171B1E',
    surfaceElevated: '#24282B',
    cameraOffSurface: '#303336',
    dock: 'rgba(32,34,35,0.90)',
    control: 'rgba(255,255,255,0.10)',
    topControl: 'rgba(12,14,17,0.42)',
    controlBorder: 'rgba(255,255,255,0.08)',
    endCall: '#FF163D',
    avatarFallback: '#7E858C',
    avatarBorder: 'rgba(255,255,255,0.16)',
    localAvatar: '#F1F2F4',
    localAvatarIcon: '#8B929B',
    voiceOverlay: 'rgba(18,21,23,0.64)',
    sheetHandle: 'rgba(247,247,248,0.65)',
    textPrimary: '#F7F7F8',
    textSecondary: 'rgba(247,247,248,0.64)',
    textMuted: 'rgba(247,247,248,0.54)',
    scrim: 'rgba(5,9,12,0.72)',
  },
  // Semantic
  surface: {
    card: '#FFFFFF',
    input: '#F5F5F5',
    modal: '#FFFFFF',
    accent: '#FFF4EC',
    error: '#FFF1F0',
    muted: '#F5F5F5',
  },
  // Messages
  bubble: {
    outgoing: '#FF6B2C',
    incoming: '#F4F4F4',
    outgoingText: '#FFFFFF',
    incomingText: '#161616',
  },
  // Borders
  border: {
    default: '#ECECEC',
    light: '#F4F4F4',
    strong: '#D9D9D9',
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
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 4,
  },
  glow: {
    shadowColor: '#FF6B2C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 6,
  },
}
