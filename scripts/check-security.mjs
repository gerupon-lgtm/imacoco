import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [indexHtml, headers, packageJson] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'public/_headers'), 'utf8'),
  readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse)
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(/<meta\s+name="robots"\s+content="noindex, nofollow, noarchive"/.test(indexHtml), 'index.htmlのnoindexがありません')
for (const header of [
  'X-Robots-Tag: noindex, nofollow, noarchive',
  'Content-Security-Policy:',
  'Referrer-Policy: no-referrer',
  'Permissions-Policy: geolocation=(self)',
  'X-Content-Type-Options: nosniff',
  'Cross-Origin-Opener-Policy: same-origin'
]) {
  assert(headers.includes(header), `_headersに${header}がありません`)
}

for (const origin of [
  'https://api.open-meteo.com',
  'https://marine-api.open-meteo.com',
  'https://mreversegeocoder.gsi.go.jp'
]) {
  assert(headers.includes(origin) && indexHtml.includes(origin), `${origin}のCSPがHTMLと_headersで一致しません`)
}

assert(!headers.includes("'unsafe-eval'"), 'CSPでunsafe-evalを許可しないでください')
assert(headers.includes("frame-ancestors 'none'"), 'クリックジャッキング防止がありません')

const dependencyNames = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.devDependencies ?? {})
])
for (const forbidden of ['@sentry/browser', 'posthog-js', 'mixpanel-browser', 'firebase', 'gtag']) {
  assert(!dependencyNames.has(forbidden), `解析・外部保存依存 ${forbidden} はMVPへ追加できません`)
}

console.log('security policy ok: noindex, CSP, privacy headers, no analytics dependencies')
