import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync, mkdirSync } from 'fs'

const buildId = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'write-version-json',
      closeBundle() {
        mkdirSync('dist', { recursive: true })
        writeFileSync('dist/version.json', JSON.stringify({ v: buildId }))
      },
    },
  ],
  base: '/tm-opsperformance/',
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
        },
      },
    },
  },
})
