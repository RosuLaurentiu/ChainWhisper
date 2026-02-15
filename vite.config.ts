import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/coti-messaging-app/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('@coti-io/coti-ethers')) {
            return 'coti-ethers';
          }

          if (id.includes('react') || id.includes('scheduler')) {
            return 'react-vendor';
          }

          return 'vendor';
        }
      }
    }
  }
});
