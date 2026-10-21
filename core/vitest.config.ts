import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.kin/**', '**/dist/**'],
    fileParallelism: false,
    pool: 'threads',
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      KIN_ISOLATE_OLLAMA: 'true',
      KIN_ISOLATE_GLOBAL_MCP: 'true',
    },
  },
});
