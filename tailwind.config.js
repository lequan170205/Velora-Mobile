/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        'bg-primary':      '#121212',
        'bg-secondary':    '#111118',
        'bg-elevated':     '#1A1A24',
        'bg-glass':        'rgba(255,255,255,0.04)',
        'bg-glass-border': 'rgba(255,255,255,0.08)',
        // Surfaces
        'surface-card':  '#1E1E24',
        'surface-input': '#1E1E24',
        'surface-modal': '#1E1E2C',
        'surface-focus': '#26262E',
        // Brand
        'brand':        '#0A7CFF',
        'brand-violet': '#6C63FF',
        // Text
        'text-primary':   '#f8fafc',
        'text-secondary': '#94a3b8',
        'text-muted':     '#64748b',
        // Status
        'status-online':   '#4ade80',
        'status-error':    '#ef4444',
        'status-success':  '#34D399',
        'call-green':      '#22c55e',
        // Overlays
        'overlay': 'rgba(10,10,15,0.95)',
        // Message Bubbles
        'bubble-out': '#0A7CFF',
        'bubble-in':  '#1E1E2C',
      },
      fontSize: {
        'xs2':     ['11px', { lineHeight: '16px' }],
        'sm2':     ['13px', { lineHeight: '18px' }],
        'base2':   ['14px', { lineHeight: '20px' }],
        'base':    ['15px', { lineHeight: '22px' }],
        'md':      ['16px', { lineHeight: '22px' }],
        'lg':      ['18px', { lineHeight: '26px' }],
        'xl':      ['22px', { lineHeight: '30px' }],
        'xxl':     ['28px', { lineHeight: '36px' }],
        'display': ['32px', { lineHeight: '40px' }],
        'hero':    ['34px', { lineHeight: '42px' }],
      },
      fontFamily: {
        sans:     ['Inter_400Regular'],
        medium:   ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold:     ['Inter_700Bold'],
        display:  ['SpaceGrotesk_700Bold'],
        heading:  ['SpaceGrotesk_600SemiBold'],
      },
      borderRadius: {
        'sm':        '8px',
        'md':        '12px',
        'lg':        '16px',
        'xl':        '20px',
        'badge':     '14px',
        'avatar-sm': '18px',
        'avatar':    '28px',
        'avatar-lg': '80px',
        'bubble-sm': '4px',
        'full':      '9999px',
      },
      spacing: {
        '4.5': '18px',
        '13':  '52px',
        '14':  '56px',
        '18':  '72px',
      },
    },
  },
  plugins: [],
}
