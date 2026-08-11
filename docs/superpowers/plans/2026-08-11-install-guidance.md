# PWAインストール案内 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS／iPadOS、Android、PCの対応ブラウザで、初回位置説明後に端末別のPWAインストール案内を一度だけ表示する。

**Architecture:** ブラウザ固有のインストールイベントを`src/pwa/installExperience.ts`へ隔離し、React UIは小さな状態・操作インターフェースだけを受け取る。表示済み状態は既存`AppSettings`へ追加し、初回位置説明と既存モーダルを優先する。

**Tech Stack:** React、TypeScript、Vite、vite-plugin-pwa、Zod、Vitest、Testing Library、Playwright、Cloudflare Pages

## Global Constraints

- Android／PCは`beforeinstallprompt`を受信した場合だけ案内し、非対応ブラウザでは表示しない。
- iOS／iPadOSはSafariの共有から「ホーム画面に追加」する説明だけを表示し、共有シートを自動操作しない。
- standalone起動済み、表示済み、または既存モーダル表示中は案内しない。
- 位置情報の初回説明を最優先し、その完了後にインストール案内を表示する。
- 表示済み状態はlocalStorageの`AppSettings.installPromptSeen`へ保存し、全消去で解除する。
- 外部アイコン、解析、通知許可、サーバー保存、追加依存パッケージを導入しない。
- 医療注記は「緊急時は119」に戻す。

---

## File Structure

- Create `src/pwa/installExperience.ts`: OS／standalone判定、`beforeinstallprompt`保持、`appinstalled`監視、インストール要求を担当する。
- Create `src/pwa/installExperience.test.ts`: ブラウザ状態アダプターの単体テスト。
- Modify `src/storage/appSettings.ts`: `installPromptSeen`の既定値・旧保存形式移行・更新を担当する。
- Modify `src/storage/appSettings.test.ts`: 設定移行、保存、全消去を検証する。
- Modify `src/main.tsx`: 実ブラウザ用アダプターを1個だけ生成して`App`へ注入する。
- Modify `src/App.tsx`: 表示順制御、端末別文言、操作、表示済み保存を担当する。
- Modify `src/App.css`: 既存テーマへ追従するインストールモーダルのレスポンシブ表示を定義する。
- Modify `src/App.test.tsx`: 初回説明優先、iOS、Android／PC、表示済み非表示を検証する。
- Modify `e2e/dashboard.spec.ts`: 実ブラウザイベント注入、再訪、standalone、狭幅表示と医療注記を検証する。
- Modify `要件定義書_いまここインフォ.md`, `docs/screens.md`, `docs/data-model.md`, `docs/api-design.md`, `docs/tasks.md`, `基本設計サマリ.md`, `docs/deployment.md`: 要件・画面・データ・処理・作業記録・運用確認を実装へ同期する。

### Task 1: ブラウザインストール状態アダプター

**Files:**
- Create: `src/pwa/installExperience.ts`
- Create: `src/pwa/installExperience.test.ts`

**Interfaces:**
- Produces: `InstallExperienceState = 'waiting' | 'ios' | 'installable' | 'installed'`
- Produces: `InstallOutcome = 'accepted' | 'dismissed'`
- Produces: `InstallExperience` with `getState(): InstallExperienceState`, `subscribe(listener: () => void): () => void`, `install(): Promise<InstallOutcome>`, `destroy(): void`
- Produces: `createInstallExperience(target: Window): InstallExperience`

- [ ] **Step 1: Write the failing adapter tests**

```ts
it('iPhoneブラウザをiosとして開始する', () => {
  const target = createFakeWindow({ userAgent: 'iPhone', platform: 'iPhone' })
  expect(createInstallExperience(target).getState()).toBe('ios')
})

it('beforeinstallpromptを保持してinstallableへ遷移する', async () => {
  const target = createFakeWindow()
  const experience = createInstallExperience(target)
  const event = createInstallPromptEvent('accepted')
  target.dispatchEvent(event)
  expect(event.preventDefault).toHaveBeenCalled()
  expect(experience.getState()).toBe('installable')
  expect(await experience.install()).toBe('accepted')
  expect(event.prompt).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- src/pwa/installExperience.test.ts`

Expected: FAIL because `installExperience.ts` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

```ts
export type InstallExperienceState = 'waiting' | 'ios' | 'installable' | 'installed'
export type InstallOutcome = 'accepted' | 'dismissed'

export type InstallExperience = {
  getState(): InstallExperienceState
  subscribe(listener: () => void): () => void
  install(): Promise<InstallOutcome>
  destroy(): void
}

export function createInstallExperience(target: Window): InstallExperience {
  // standaloneとiOSを初期判定し、beforeinstallpromptとappinstalledを購読する。
  // install()は保持イベントのprompt()とuserChoiceを使用する。
}
```

実装ではiPadOSの`platform === 'MacIntel' && maxTouchPoints > 1`、`matchMedia('(display-mode: standalone)')`、`navigator.standalone`も判定する。保持イベントがない`install()`は`dismissed`を返す。

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm.cmd test -- src/pwa/installExperience.test.ts`

Expected: iOS、iPadOS、standalone、イベント遷移、購読解除、`appinstalled`の全テストがPASS。

- [ ] **Step 5: Commit the adapter**

```powershell
git add src/pwa/installExperience.ts src/pwa/installExperience.test.ts
git commit -m "feat: add pwa install experience adapter"
```

### Task 2: 表示済み設定の後方互換保存

**Files:**
- Modify: `src/storage/appSettings.ts`
- Modify: `src/storage/appSettings.test.ts`

**Interfaces:**
- Produces: `AppSettings.installPromptSeen: boolean`
- Consumes: `readAppSettings()`, `updateAppSettings()`, `clearAppSettings()`

- [ ] **Step 1: Write failing migration and reset tests**

```ts
it('旧形式ではインストール案内を未確認として補完する', () => {
  localStorage.setItem('imakoko-info:settings', JSON.stringify({
    schemaVersion: 1,
    onboardingAccepted: true,
    expandedCards: [],
    theme: 'system',
    lastSeenAppVersion: '0.1.0'
  }))
  expect(readAppSettings().installPromptSeen).toBe(false)
})

it('表示済みを保存し全消去で未確認へ戻す', () => {
  updateAppSettings({ installPromptSeen: true })
  expect(readAppSettings().installPromptSeen).toBe(true)
  clearAppSettings()
  expect(readAppSettings().installPromptSeen).toBe(false)
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm.cmd test -- src/storage/appSettings.test.ts`

Expected: FAIL because `installPromptSeen` is not in `AppSettings`.

- [ ] **Step 3: Add the defaulted schema field**

```ts
const appSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  onboardingAccepted: z.boolean(),
  installPromptSeen: z.boolean().default(false),
  expandedCards: z.array(z.string()),
  theme: z.enum(['system', 'light', 'dark']),
  lastSeenAppVersion: z.string()
})
```

`defaultSettings()`にも`installPromptSeen: false`を追加し、schema versionは互換的な追加のため1を維持する。

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm.cmd test -- src/storage/appSettings.test.ts`

Expected: 新旧形式、破損形式、保存、全消去がすべてPASS。

- [ ] **Step 5: Commit the settings change**

```powershell
git add src/storage/appSettings.ts src/storage/appSettings.test.ts
git commit -m "feat: remember install guidance dismissal"
```

### Task 3: 端末別の初回インストールモーダル

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: `InstallExperience` and `createInstallExperience(window)` from Task 1
- Consumes: `AppSettings.installPromptSeen` from Task 2
- Extends: `AppProps.installExperience?: InstallExperience`

- [ ] **Step 1: Write failing component tests**

```tsx
it('初回位置説明の完了後にiOS案内を表示して記録する', async () => {
  render(<App initialMode="intro" installExperience={fakeExperience('ios')} />)
  expect(screen.queryByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '今は使わない' }))
  expect(screen.getByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'わかりました' }))
  expect(readAppSettings().installPromptSeen).toBe(true)
})

it('installableならブラウザのインストール要求を呼ぶ', async () => {
  const experience = fakeExperience('installable')
  render(<App initialMode="idle" installExperience={experience} />)
  await userEvent.click(screen.getByRole('button', { name: 'インストール' }))
  expect(experience.install).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Run the focused component tests and confirm RED**

Run: `npm.cmd test -- src/App.test.tsx`

Expected: FAIL because `installExperience` and the dialogs are absent.

- [ ] **Step 3: Inject the singleton and implement visibility rules**

```tsx
const [installState, setInstallState] = useState(
  () => installExperience?.getState() ?? 'installed'
)
const [installPromptSeen, setInstallPromptSeen] = useState(
  () => readAppSettings().installPromptSeen
)

const showInstallGuidance = !isIntro
  && openPanel === null
  && !installPromptSeen
  && (installState === 'ios' || installState === 'installable')
```

`main.tsx`は`createInstallExperience(window)`を1回だけ作って`App`へ渡す。`App`は状態購読を解除し、閉じる／インストール後に`updateAppSettings({ installPromptSeen: true })`を呼ぶ。Escape、背景クリック、「今はしない」「わかりました」で閉じられるようにする。

- [ ] **Step 4: Add themed responsive styling and medical copy fix**

`.install-guidance-panel`は既存CSS変数を使い、最大幅460px、16px以上の画面端余白、44px以上の操作高、ライト／ダーク双方の十分なコントラストを持たせる。`src/App.tsx`内のプレビューと実データの「緊急時は119へ」を「緊急時は119」へ変更する。

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm.cmd test -- src/App.test.tsx src/storage/appSettings.test.ts src/pwa/installExperience.test.ts`

Expected: 初回説明優先、iOS、Android／PC、表示済み、既存モーダル優先、Escape、医療注記のテストがPASS。

- [ ] **Step 6: Commit the UI**

```powershell
git add src/main.tsx src/App.tsx src/App.css src/App.test.tsx
git commit -m "feat: show platform-aware install guidance"
```

### Task 4: ブラウザ回帰と文書同期

**Files:**
- Modify: `e2e/dashboard.spec.ts`
- Modify: `要件定義書_いまここインフォ.md`
- Modify: `docs/screens.md`
- Modify: `docs/data-model.md`
- Modify: `docs/api-design.md`
- Modify: `docs/tasks.md`
- Modify: `基本設計サマリ.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: DOM copy and browser events from Tasks 1-3
- Produces: Requirements revision 1.8 and T-014/T-015/T-017 work record

- [ ] **Step 1: Add failing E2E scenarios**

```ts
test('iOS案内は初回説明後に一度だけ表示する', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'iPhone' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '今は使わない' }).click()
  await expect(page.getByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })).toBeVisible()
  await page.getByRole('button', { name: 'わかりました' }).click()
  await page.reload()
  await expect(page.getByRole('dialog', { name: 'いまここインフォをホーム画面に追加' })).toHaveCount(0)
})

test('beforeinstallpromptがあるとインストール操作を提示する', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' })
    })
    window.dispatchEvent(event)
  })
  await expect(page.getByRole('button', { name: 'インストール' })).toBeVisible()
})
```

- [ ] **Step 2: Run the focused E2E and confirm expected failures**

Run: `npx.cmd playwright test e2e/dashboard.spec.ts --grep "インストール|ホーム画面"`

Expected: Any remaining event timing, persistence, or layout mismatch fails with a specific assertion.

- [ ] **Step 3: Complete E2E coverage and update the medical assertion**

Add standalone suppression, Android／PC install invocation, 390px light/dark overflow, focus target, and reload persistence. Replace exact E2E copy `緊急時は119へ` with `緊急時は119`.

- [ ] **Step 4: Synchronize canonical documents**

Update FR-001 acceptance criteria with the supported-browser first-access guidance, add S-015, add `installPromptSeen`, document the install adapter events, record T-014/T-015/T-017 completion, add deployment smoke steps, and append requirements revision `1.8 | 2026-08-11`.

- [ ] **Step 5: Run complete verification**

Run: `npm.cmd run check`

Run: `npm.cmd run test:e2e`

Expected: typecheck, unit/integration, static-data validation, version validation, build, all E2E tests PASS; `dist/registerSW.js`, `dist/manifest.webmanifest`, and `dist/sw.js` exist.

- [ ] **Step 6: Commit E2E and docs**

```powershell
git add e2e/dashboard.spec.ts 要件定義書_いまここインフォ.md docs/screens.md docs/data-model.md docs/api-design.md docs/tasks.md 基本設計サマリ.md docs/deployment.md
git commit -m "docs: define pwa install guidance flow"
```

### Task 5: PR、mainマージ、本番確認

**Files:**
- No source file changes expected.

**Interfaces:**
- Consumes: clean verified branch `feat/install-guidance`
- Produces: merged GitHub PR and successful Cloudflare Pages production deployment

- [ ] **Step 1: Confirm clean branch and commit range**

Run: `git status --short --branch`

Run: `git log --oneline main..HEAD`

Expected: working tree is clean and only install-guidance commits are listed.

- [ ] **Step 2: Push and create the PR**

```powershell
git push -u origin feat/install-guidance
gh pr create --base main --head feat/install-guidance --title "feat: add PWA install guidance" --body-file .github/pr-body-install-guidance.md
```

The PR body lists iOS instructions, Android／PC capability detection, persistence, the medical copy fix, and exact verification commands.

- [ ] **Step 3: Wait for checks and merge**

Run: `gh pr checks --watch`

Run: `gh pr merge --merge --delete-branch`

Expected: all required checks succeed and the PR state becomes MERGED.

- [ ] **Step 4: Verify production**

Confirm `https://imacoco.sikumilab.com/` returns HTTP 200 and references the new hashed JS/CSS assets. Confirm GitHub/Cloudflare deployment status is successful, then verify the iOS explanation and injected Chromium install event against the production build without logging coordinates.

