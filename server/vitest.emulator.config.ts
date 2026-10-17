import { defineConfig } from 'vitest/config';

/** Tests against the local Firebase Auth and Firestore emulators (`npm run test:emulator`). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.emulator.test.ts'],
    // The tests share one emulator, so run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
