import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom', 'next'],
  treeshake: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  target: 'es2017',
  tsconfig: 'tsconfig.json',
})