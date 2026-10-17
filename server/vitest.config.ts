import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // These need the Firebase emulators: run them with `npm run test:emulator`.
    exclude: ['src/**/*.emulator.test.ts', 'node_modules/**'],
  },
});
