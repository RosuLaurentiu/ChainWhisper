import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  let graph: string;
  const dexBuildIdentity: Plugin = {
    name: 'current-dex-build-identity',
    apply: 'build',
    configResolved(config) {
      graph = config.env.VITE_LOW_RPC_TRIAL;
      if (mode === 'coti-testnet-candidate' && !/^[0-9a-f]{64}$/.test(graph ?? ''))
        throw new Error('Testnet build requires an explicit current DEX graph.');
    },
    generateBundle() {
      if (mode === 'coti-testnet-candidate') this.emitFile({ type: 'asset', fileName: 'DEX_BUILD_IDENTITY.json',
        source: JSON.stringify({ schema: 'CURRENT_DEX_BUILD_V1', graph }) + '\n' });
    }
  };
  return {
  // Custom domain (chainwhisper.app) serves the app from root.
  base: '/',
  plugins: [react(), dexBuildIdentity],
  // Manual testnet wallet journeys must run against one stable client build.
  // Applying Fast Refresh while MetaMask/Snap prompts or reads are active can
  // preserve incompatible React state and repeatedly reconnect wallet streams.
  // Candidate edits become visible only after an intentional page reload.
  server: {
    ...(mode === 'coti-testnet-candidate' ? { hmr: false } : {}),
    // Evidence snapshots are not App inputs; watching them blocks cold startup.
    watch: { ignored: ['**/reports/**'] }
  },
  test: {
    // CW-114: reports/ keeps evidence snapshots with old copies of src tests. A `vitest run src` path
    // filter also matches reports/**/src, so those copies must never be collected.
    exclude: [...configDefaults.exclude, 'reports/**']
  },
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
  };
});
