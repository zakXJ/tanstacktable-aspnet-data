import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
})
