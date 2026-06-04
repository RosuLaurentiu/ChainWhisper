import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const getNodeModulePackageName = (id: string): string | undefined => {
  const normalized = id.replace(/\\/g, '/');
  const nodeModuleParts = normalized.split('/node_modules/');
  const packagePath = nodeModuleParts[nodeModuleParts.length - 1];
  if (!packagePath || packagePath.startsWith('.')) {
    return undefined;
  }

  const [firstPart, secondPart] = packagePath.split('/');
  if (!firstPart) {
    return undefined;
  }

  return firstPart.startsWith('@') && secondPart ? `${firstPart}/${secondPart}` : firstPart;
};

const resolveVendorChunk = (id: string): string | undefined => {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  const packageName = getNodeModulePackageName(id);
  if (!packageName) {
    return undefined;
  }

  if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') {
    return 'react-vendor';
  }

  if (packageName === '@coti-io/coti-ethers') {
    return 'coti-ethers';
  }

  if (
    packageName === 'viem' ||
    packageName === 'abitype' ||
    packageName === 'ox' ||
    packageName.startsWith('@noble/') ||
    packageName.startsWith('@scure/')
  ) {
    return 'web3-vendor';
  }

  if (packageName === 'recharts' || packageName.startsWith('d3-')) {
    return 'charts-vendor';
  }

  if (packageName.startsWith('@supabase/')) {
    return 'supabase-vendor';
  }

  if (packageName === 'fflate') {
    return 'compression-vendor';
  }

  return undefined;
};

export default defineConfig({
  // Custom domain (chainwhisper.chat) serves the app from root.
  base: '/',
  plugins: [react()],
  server: {
    proxy: {
      '/carbon-mcp': {
        target: 'https://mcp.carbondefi.xyz',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/carbon-mcp/u, '')
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: resolveVendorChunk
      }
    }
  }
});
