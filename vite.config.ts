import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const VENDOR_GROUPS: Record<string, string> = {
  react: 'react-vendor',
  'react-dom': 'react-vendor',
  scheduler: 'react-vendor',
  '@coti-io/coti-ethers': 'coti-ethers'
};

const resolveVendorChunk = (id: string): string | undefined => {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  const normalized = id.replace(/\\/g, '/');
  for (const [pkgName, chunkName] of Object.entries(VENDOR_GROUPS)) {
    if (normalized.includes(`/node_modules/${pkgName}/`) || normalized.includes(`/node_modules/.pnpm/${pkgName}@`)) {
      return chunkName;
    }
  }

  return 'vendor';
};

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/coti-messaging-app/' : '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: resolveVendorChunk
      }
    }
  }
});
