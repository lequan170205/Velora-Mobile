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
        // Backgrounds — Light, clean white
        'bg-primary':      '#FFFFFF',
        'bg-secondary':    '#F2F2F7',
        'bg-elevated':     '#FFFFFF',
        'bg-glass':        'rgba(0,0,0,0.02)',
        'bg-glass-border': 'rgba(0,0,0,0.06)',
        // Surfaces
        'surface-card':  '#F2F2F7',
        'surface-input': '#F8F8F8',
        'surface-modal': '#FFFFFF',
        'surface-focus': '#EBEBF0',
        // Brand — Warm Orange
        'brand':        '#FF6B2C',
        'brand-light':  '#FF8F5C',
        'brand-dark':   '#E55A1B',
        // Text — Dark on light
        'text-primary':   '#1C1C1E',
        'text-secondary': '#8E8E93',
        'text-muted':     '#AEAEB2',
        // Status
        'status-online':   '#34C759',
        'status-error':    '#FF3B30',
        'status-success':  '#34C759',
        'call-green':      '#34C759',
        // Borders
        'border-default':  '#E5E5EA',
        'border-light':    '#F2F2F7',
        // Overlays
        'overlay': 'rgba(0,0,0,0.4)',
        // Message Bubbles
        'bubble-out': '#FF6B2C',
        'bubble-in':  '#F2F2F7',
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
