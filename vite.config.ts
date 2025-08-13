import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Cross-platform path resolution
const resolveAbsolute = (...paths: string[]) => resolve(__dirname, ...paths)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    // Cross-platform build settings
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: false,
    // Ensure consistent builds across platforms
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: resolveAbsolute('src', 'renderer', 'index.html')
    }
  },
  resolve: {
    alias: {
      '@': resolveAbsolute('src'),
      '@renderer': resolveAbsolute('src', 'renderer'),
      '@shared': resolveAbsolute('src', 'shared')
    }
  },
  server: {
    host: 'localhost',
    port: 5173
  },
  publicDir: resolveAbsolute('public'),
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }
}) 