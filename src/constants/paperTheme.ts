import { MD3DarkTheme } from 'react-native-paper'
import type { MD3Theme } from 'react-native-paper'

export const paperTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary:          '#0A7CFF',
    secondary:        '#6C63FF',
    background:       '#121212',
    surface:          '#1E1E24',
    surfaceVariant:   '#26262E',
    error:            '#ef4444',
    onPrimary:        '#ffffff',
    onSecondary:      '#ffffff',
    onBackground:     '#f8fafc',
    onSurface:        '#f8fafc',
    onSurfaceVariant: '#94a3b8',
    outline:          '#1E1E24',
    elevation: {
      level0: 'transparent',
      level1: '#1A1A24',
      level2: '#1E1E24',
      level3: '#26262E',
      level4: '#2E2E3E',
      level5: '#333347',
    },
  },
}
