import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.kin/**', '**/dist/**'],
    fileParallelism: false,
    env: {
      KIN_ISOLATE_OLLAMA: 'true',
    },
  },
});
