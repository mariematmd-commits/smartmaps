import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served from https://<user>.github.io/smartmaps/, so asset URLs need
// that prefix. Must match the GitHub repo name exactly.
export default defineConfig({
  base: '/smartmaps/',
  plugins: [react()],
  server: {
    port: 5173,
  },
});
