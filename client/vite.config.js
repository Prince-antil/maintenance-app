import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    minify: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Keep React & Core DOM isolated — exact package name matching only
            if (id.match(/node_modules[\\/](react|react-dom|react-router|react-router-dom|react-is|scheduler)[\\/]/) ||
                id.includes('node_modules/@remix-run/router/')) {
              return 'vendor-react';
            }
            // Keep Supabase isolated
            if (id.includes('@supabase') || id.includes('supabase')) {
              return 'vendor-supabase';
            }
            // Keep icons separate
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            // All other third-party UI packages
            return 'vendor-utils';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      }
    }
  }
})
