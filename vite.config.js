import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  // จำกัดการสแกน Dependencies เฉพาะหน้าเว็บหลัก
  optimizeDeps: {
    entries: ['index.html'],
  },

  base: './',

  server: {
    host: '0.0.0.0',
    allowedHosts: [
      '.trycloudflare.com',
    ],
  },
})