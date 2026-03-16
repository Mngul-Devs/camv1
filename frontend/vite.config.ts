import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8100';

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  server: {
    port: 5173,
    // Allow Cloudflare Quick Tunnel random hostnames during local dev.
    // This prevents "Blocked request. This host is not allowed" on restart.
    allowedHosts: true,
    proxy: {
      // Use host-only cookies so auth works on random tunnel hosts too.
      '/admin': { target: API_TARGET, changeOrigin: true, cookieDomainRewrite: '' },
      '/api':   { target: API_TARGET, changeOrigin: true, cookieDomainRewrite: '' },
      '/login': { target: API_TARGET, changeOrigin: true, cookieDomainRewrite: '' },
      '/logout':{ target: API_TARGET, changeOrigin: true, cookieDomainRewrite: '' },
      '/health':{ target: API_TARGET, changeOrigin: true, cookieDomainRewrite: '' },
      '/static':{ target: API_TARGET, changeOrigin: true },
    },
  },
})
