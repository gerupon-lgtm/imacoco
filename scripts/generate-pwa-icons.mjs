import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'public/favicon.svg'), 'utf8')
const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})

async function renderIcon(fileName, size, opaqueBackground) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<!doctype html><style>
    html, body { width: ${size}px; height: ${size}px; margin: 0; background: transparent; overflow: hidden; }
    svg { display: block; width: ${size}px; height: ${size}px; }
  </style>${source}`)

  await page.locator('svg').evaluate((svg, opaque) => {
    svg.setAttribute('width', '100%')
    svg.setAttribute('height', '100%')
    if (opaque) svg.querySelector('rect')?.removeAttribute('rx')
  }, opaqueBackground)

  await page.locator('svg').screenshot({
    path: resolve(root, `public/${fileName}`),
    omitBackground: !opaqueBackground
  })
  await page.close()
}

try {
  await renderIcon('icon-192.png', 192, false)
  await renderIcon('icon-512.png', 512, false)
  await renderIcon('icon-maskable-512.png', 512, true)
  await renderIcon('apple-touch-icon.png', 180, true)
} finally {
  await browser.close()
}

process.stdout.write('PWA icons generated from public/favicon.svg\n')
