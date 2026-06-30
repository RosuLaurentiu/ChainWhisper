import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Custom domain (chainwhisper.chat) serves the app from root.
  base: '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900
  }
});
