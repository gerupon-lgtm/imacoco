import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'))
const versionSource = await readFile(resolve('src/version.ts'), 'utf8')
const match = versionSource.match(/APP_VERSION = '([^']+)'/)

if (!match || match[1] !== packageJson.version) {
  throw new Error(`version mismatch: package.json=${packageJson.version}, src/version.ts=${match?.[1] ?? 'missing'}`)
}

process.stdout.write(`version ok: iki-${packageJson.version}\n`)
