import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const versionSource = await readFile(resolve('src/version.ts'), 'utf8')
const viteSource = await readFile(resolve('vite.config.ts'), 'utf8')
const match = versionSource.match(/APP_VERSION = '([^']+)'/)
const displayPrefix = versionSource.match(/APP_DISPLAY_VERSION = `([^$]+)\$\{APP_VERSION\}`/)?.[1]

if (!match || match[1] !== packageJson.version) {
  throw new Error(`version mismatch: package.json=${packageJson.version}, src/version.ts=${match?.[1] ?? 'missing'}`)
}

if (displayPrefix !== 'mvp-') {
  throw new Error(`display version prefix mismatch: expected=mvp-, actual=${displayPrefix ?? 'missing'}`)
}

if (!viteSource.includes('cacheId: `imakoko-info-mvp-${packageVersion}`')) {
  throw new Error('PWA cache version prefix mismatch: expected imakoko-info-mvp-${packageVersion}')
}

process.stdout.write(`version ok: mvp-${packageJson.version}\n`)
