/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Backgrounds — Minimal neutral canvas
        'bg-primary': '#FFFFFF',
        'bg-secondary': '#F7F7F7',
        'bg-elevated': '#FFFFFF',
        'bg-glass': 'rgba(255,255,255,0.88)',
        'bg-glass-border': 'rgba(17,17,17,0.05)',
        // Surfaces
        'surface-card': '#FFFFFF',
        'surface-input': '#F5F5F5',
        'surface-modal': '#FFFFFF',
        'surface-focus': '#F5F5F5',
        'surface-accent': '#FFF4EC',
        'surface-muted': '#F5F5F5',
        // Brand — Clean orange accent
        brand: '#FF6B2C',
        'brand-light': '#FF935B',
        'brand-dark': '#D85A21',
        'brand-soft': '#FFF0E4',
        // Text — Crisp neutral hierarchy
        'text-primary': '#161616',
        'text-secondary': '#777777',
        'text-muted': '#A6A6A6',
        'text-subtle': '#BEBEBE',
        // Status
        'status-online': '#34C759',
        'status-error': '#FF3B30',
        'status-success': '#34C759',
        'call-green': '#34C759',
        // Borders
        'border-default': '#ECECEC',
        'border-light': '#F4F4F4',
        'border-strong': '#D9D9D9',
        // Overlays
        overlay: 'rgba(0,0,0,0.4)',
        // Message Bubbles
        'bubble-out': '#FF6B2C',
        'bubble-in': '#F4F4F4',
      },
      fontSize: {
        xs2: ['11px', { lineHeight: '16px' }],
        sm2: ['13px', { lineHeight: '18px' }],
        base2: ['14px', { lineHeight: '20px' }],
        base: ['15px', { lineHeight: '22px' }],
        md: ['16px', { lineHeight: '22px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['22px', { lineHeight: '30px' }],
        xxl: ['28px', { lineHeight: '36px' }],
        display: ['32px', { lineHeight: '40px' }],
        hero: ['34px', { lineHeight: '42px' }],
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        medium: ['Inter_500Medium'],
        semibold: ['Inter_600SemiBold'],
        bold: ['Inter_700Bold'],
        display: ['SpaceGrotesk_700Bold'],
        heading: ['SpaceGrotesk_600SemiBold'],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        badge: '14px',
        'avatar-sm': '18px',
        avatar: '28px',
        'avatar-lg': '80px',
        'bubble-sm': '4px',
        full: '9999px',
      },
      spacing: {
        4.5: '18px',
        13: '52px',
        14: '56px',
        18: '72px',
      },
    },
  },
  plugins: [],
}
