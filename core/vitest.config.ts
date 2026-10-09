import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.kin/**', '**/dist/**'],
    fileParallelism: false,
    pool: 'threads',
    env: {
      KIN_ISOLATE_OLLAMA: 'true',
    },
  },
});
