import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // sandboxed preload scripts must be CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    worker: { format: 'es' },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    }
  }
})
