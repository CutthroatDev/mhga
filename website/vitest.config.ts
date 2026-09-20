import { defineConfig } from 'vitest/config';

// A deliberately small suite: business/data-integrity rules only (see README "Tests").
// Plain Node environment: the tests run the real repositories against an isolated in-memory
// D1 (Miniflare) and never touch .wrangler/state or the remote database.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Starting the local D1 (workerd) takes a moment on a cold machine.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
