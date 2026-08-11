import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifest = JSON.parse(await readFile(resolve('dist/manifest.webmanifest'), 'utf8'))
const expectedName = 'いまここインフォ'

if (manifest.name !== expectedName || manifest.short_name !== expectedName) {
  throw new Error(
    `PWA manifest name mismatch: expected=${expectedName}, name=${manifest.name ?? 'missing'}, short_name=${manifest.short_name ?? 'missing'}`
  )
}

process.stdout.write(`PWA manifest name ok: ${expectedName}\n`)
