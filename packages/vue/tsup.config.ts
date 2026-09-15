import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/query.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['vue', '@tanstack/vue-table', '@tanstack/vue-query'],
})