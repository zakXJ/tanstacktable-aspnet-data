import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/query.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', 'react/jsx-runtime', '@tanstack/react-table', '@tanstack/react-query'],
})