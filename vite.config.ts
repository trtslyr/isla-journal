import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, join } from 'path'

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
      input: resolveAbsolute('src', 'renderer', 'index.html'),
      external: ['electron']
    }
  },
  resolve: {
    alias: {
      '@': resolveAbsolute('src'),
      '@main': resolveAbsolute('src', 'main'),
      '@renderer': resolveAbsolute('src', 'renderer'),
      '@shared': resolveAbsolute('src', 'shared')
    }
  },
  server: {
    host: 'localhost',
    port: 5173
  },
  // Remove publicDir reference to non-existent build directory
  publicDir: false,
  // Cross-platform optimizations
  optimizeDeps: {
    include: ['react', 'react-dom']
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }
}) 