import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],

    // Hooks boot a WASM Postgres, which takes ~1.5s locally and is slower and
    // more variable on a cold CI runner, so they get real headroom.
    hookTimeout: 30_000,

    // Tests themselves only query an already-booted instance. Keeping this
    // tight means a genuinely hung test fails fast instead of hiding behind a
    // blanket allowance.
    testTimeout: 10_000,
  },
});
