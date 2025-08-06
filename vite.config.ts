import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'src/renderer/index.html')
    },
    // Ensure build works on Windows
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false
  },
  resolve: {
    alias: {
      '@': resolve(process.cwd(), 'src'),
      '@main': resolve(process.cwd(), 'src/main'),
      '@renderer': resolve(process.cwd(), 'src/renderer'),
      '@shared': resolve(process.cwd(), 'src/shared')
    }
  },
  server: {
    host: 'localhost',
    port: 5173
  },
  publicDir: resolve(process.cwd(), 'build'),
  copyPublicDir: true,
  // Windows-specific optimizations
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }
}) 