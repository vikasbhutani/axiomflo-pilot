/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` forwards /api to the AxiomFlo API running locally (`cd server && npm run dev`),
    // so the browser uses one address, as it does in production.
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'node',
    // Component tests (.test.tsx) run in a simulated browser.
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
