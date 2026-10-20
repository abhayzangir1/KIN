import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.kin/**', '**/dist/**', 'core/.kin/**'],
    fileParallelism: false,
    pool: 'threads',
    env: {
      KIN_ISOLATE_OLLAMA: 'true',
      KIN_ISOLATE_GLOBAL_MCP: 'true',
    },
  },
});
