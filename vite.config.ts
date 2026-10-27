import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'mobile' ? [{
    name: 'phone-local-storage', enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (source === './store.js' && importer?.replaceAll('\\', '/').includes('/server/')) return path.resolve('src/mobile/store.ts');
      if (source === 'node-ical') return path.resolve('src/mobile/ical.ts');
    },
  }] : [])],
  define: { __MOBILE__: JSON.stringify(mode === 'mobile') },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: mode === 'mobile' ? 'dist-mobile' : 'dist',
    emptyOutDir: true,
  },
}));
