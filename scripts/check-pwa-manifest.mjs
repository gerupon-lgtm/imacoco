import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const manifest = JSON.parse(await readFile(resolve('dist/manifest.webmanifest'), 'utf8'))
const expectedName = 'いまここインフォ'

if (manifest.name !== expectedName || manifest.short_name !== expectedName) {
  throw new Error(
    `PWA manifest name mismatch: expected=${expectedName}, name=${manifest.name ?? 'missing'}, short_name=${manifest.short_name ?? 'missing'}`
  )
}

const iconDefinitions = new Map((manifest.icons ?? []).map((icon) => [icon.src, icon]))
if (iconDefinitions.get('icon-512.png')?.purpose !== 'any') {
  throw new Error('PWA manifest must use icon-512.png as the transparent any-purpose icon')
}
if (iconDefinitions.get('icon-maskable-512.png')?.purpose !== 'maskable') {
  throw new Error('PWA manifest must provide a separate opaque maskable icon')
}

process.stdout.write(`PWA manifest name ok: ${expectedName}\n`)
