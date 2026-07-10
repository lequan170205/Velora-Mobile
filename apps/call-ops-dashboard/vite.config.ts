import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  envPrefix: ['VITE_', 'EXPO_PUBLIC_'],
  plugins: [react()],
})
