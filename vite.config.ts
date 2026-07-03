import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Custom domain (chainwhisper.chat) serves the app from root.
  base: '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) {
            return undefined;
          }

          if (normalizedId.includes('/react') || normalizedId.includes('/scheduler/')) {
            return 'react-vendor';
          }

          if (
            normalizedId.includes('/@coti-io/coti-ethers/') ||
            normalizedId.includes('/ethers/') ||
            normalizedId.includes('/@adraffy/ens-normalize/')
          ) {
            return 'ethers-vendor';
          }

          if (
            normalizedId.includes('/node-forge/') ||
            normalizedId.includes('/@noble/') ||
            normalizedId.includes('/@scure/') ||
            normalizedId.includes('/aes-js/')
          ) {
            return 'crypto-vendor';
          }

          if (normalizedId.includes('/@metamask/connect-evm/')) {
            return 'wallet-connect';
          }

          if (normalizedId.includes('/@supabase/')) {
            return 'supabase-vendor';
          }

          if (normalizedId.includes('/recharts/') || normalizedId.includes('/d3-')) {
            return 'charts-vendor';
          }

          return undefined;
        }
      }
    }
  }
});
