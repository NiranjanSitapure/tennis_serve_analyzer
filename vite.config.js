import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // TensorFlow.js is split into its own chunk automatically via the dynamic
    // import() in src/utils/poseDetector.js — no manual chunking needed.
  },
})
