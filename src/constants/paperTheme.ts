import { MD3LightTheme } from 'react-native-paper'

import type { MD3Theme } from 'react-native-paper'

export const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#FF6B2C',
    secondary: '#FF935B',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    surfaceVariant: '#F5F5F5',
    error: '#FF3B30',
    onPrimary: '#FFFFFF',
    onSecondary: '#FFFFFF',
    onBackground: '#161616',
    onSurface: '#161616',
    onSurfaceVariant: '#777777',
    outline: '#ECECEC',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FAFAFA',
      level3: '#F7F7F7',
      level4: '#F4F4F4',
      level5: '#ECECEC',
    },
  },
}
