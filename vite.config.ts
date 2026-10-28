import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  // Custom domain (chainwhisper.app) serves the app from root.
  base: '/',
  plugins: [react()],
  // Manual testnet wallet journeys must run against one stable client build.
  // Applying Fast Refresh while MetaMask/Snap prompts or reads are active can
  // preserve incompatible React state and repeatedly reconnect wallet streams.
  // Candidate edits become visible only after an intentional page reload.
  server: mode === 'coti-testnet-candidate' ? { hmr: false } : undefined,
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (normalizedId.includes('vite/preload-helper.js')) {
            return 'vite-runtime';
          }

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
}));
