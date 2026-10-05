import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const packages = ['core', 'react', 'vue']
const temporary = mkdtempSync(join(tmpdir(), 'tanstack-aspnet-data-pack-'))
const require = createRequire(import.meta.url)

try {
  for (const name of packages) {
    const directory = join(root, 'packages', name)
    execFileSync('npm', ['pack', '--dry-run', '--json', '--cache', join(temporary, 'npm-cache')], {
      cwd: directory,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    })
    const esm = await import(pathToFileURL(join(directory, 'dist', 'index.js')).href)
    const cjs = require(join(directory, 'dist', 'index.cjs'))
    if (typeof esm !== 'object' || typeof cjs !== 'object') throw new Error(`${name}: invalid module exports`)
  }

  const reactRoot = await import(pathToFileURL(join(root, 'packages/react/dist/index.js')).href)
  const vueRoot = await import(pathToFileURL(join(root, 'packages/vue/dist/index.js')).href)
  if ('useAspNetDataQuery' in reactRoot || 'useAspNetDataQuery' in vueRoot) {
    throw new Error('Query integration leaked into an optional-peer root entry')
  }
  await import(pathToFileURL(join(root, 'packages/react/dist/query.js')).href)
  await import(pathToFileURL(join(root, 'packages/vue/dist/query.js')).href)
  console.log('Package archives and ESM/CJS entry points verified')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
