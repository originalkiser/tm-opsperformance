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
  // Custom domain (ops.tmcw.app) serves from the root, not a repo subpath.
  base: '/',
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
