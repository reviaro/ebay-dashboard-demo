import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Without this, `@/` imports only resolve when they happen to be mocked.
      '@': path.resolve(__dirname, './src'),
    },
  },
});
