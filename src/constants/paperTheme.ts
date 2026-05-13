import { MD3LightTheme } from 'react-native-paper'

import type { MD3Theme } from 'react-native-paper'

export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#FF6B2C',
    secondary: '#FF8F5C',
    background: '#FFFFFF',
    surface: '#F2F2F7',
    surfaceVariant: '#EBEBF0',
    error: '#FF3B30',
    onPrimary: '#FFFFFF',
    onSecondary: '#FFFFFF',
    onBackground: '#1C1C1E',
    onSurface: '#1C1C1E',
    onSurfaceVariant: '#8E8E93',
    outline: '#E5E5EA',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#F2F2F7',
      level3: '#EBEBF0',
      level4: '#E5E5EA',
      level5: '#D1D1D6',
    },
  },
}
