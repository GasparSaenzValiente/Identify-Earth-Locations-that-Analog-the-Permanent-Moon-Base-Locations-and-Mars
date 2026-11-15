import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Native file events were dropped for some saves in this folder (Windows + accented path),
    // leaving the dev server serving stale modules. Polling is reliable and cheap at this size.
    watch: { usePolling: true, interval: 250 },
  },
  build: {
    chunkSizeWarningLimit: 2500, // three + postprocessing is a large, single-purpose bundle
  },
})
