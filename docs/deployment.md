# 公開・更新・ロールバック手順

## 1. 現在地

- GitHub: `https://github.com/gerupon-lgtm/imacoco`（公開）
- 本番ブランチ: `main`
- 修正ブランチ: 作業ごとのfeature／fixブランチからPRを作成
- 初回公開PR: `#1`（マージ済み）
- アプリ版: `mvp-0.1.1`
- 本番公開: `https://imacoco.sikumilab.com/`（Cloudflare Pages）

Cloudflare PagesのGitHub連携と独自ドメイン設定は完了済み。今後の修正はPRのCIとPreview確認後に`main`へマージする。

## 2. ローカル品質ゲート

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run test:e2e
```

`check`は版整合、全国データ全件検査、型、単体・結合テスト、本番ビルド、生成済みPWA manifestの正式名称を検査する。E2EはGPS許可、実データカード、保存データ全消去、画面順・装飾、前回位置復元、iOS／Android／PCのインストール案内条件、ライト／ダークの更新通知コントラストを確認する。

## 3. Cloudflare Pages Preview

Cloudflareの[Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)からGitHubリポジトリを接続する。公式ガイドどおり、本番ブランチ以外はPreview deploymentとして扱われる。

| 設定 | 値 |
|---|---|
| Repository | `gerupon-lgtm/imacoco` |
| Production branch | `main` |
| Framework preset | React (Vite) または Vite |
| Build command | `npm run check` |
| Build output directory | `dist` |
| Root directory | 空欄（リポジトリ直下） |
| Environment variables | なし |

Viteの標準値が`npm run build`／`dist`であることはCloudflareの[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)にも明記されている。本案件は公開前検査も実行するため、build commandだけ`npm run check`へ強化する。

接続直後は実装ブランチのPreview URLで次を確認する。

1. 初回説明の後にブラウザの位置許可が出る。
2. 地名、天気、太陽、潮、駅、役所、医療がカード単位で表示される。
3. 情報・プライバシーの各出典リンクと免責が読める。
4. 共有に緯度・経度、GPS精度、医療機関名が入らない。
5. 再読込とオフライン再訪で24時間以内の前回値が明示される。
6. `manifest.webmanifest`、`sw.js`、`_headers`が200で返る。
7. 応答に`X-Robots-Tag: noindex, nofollow, noarchive`とCSPが付く。
8. 初回位置説明中はインストール案内が重ならず、完了後のiPhone／iPadではSafariの「ホーム画面に追加」手順が一度だけ表示される。
9. Android／PCではブラウザが導入可能と判定した場合だけ「インストール」を表示し、導入済みのstandalone起動や非対応ブラウザでは表示しない。

## 4. 本番と独自ドメイン

Preview受入後にPRをマージすると`main`が本番deploymentになる。既存ドメインのサブドメイン利用を推奨する。決定したホスト名をPagesプロジェクトの`Custom domains`から必ず先に関連付ける。

Cloudflareの[Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)によれば、Cloudflare DNS管理下なら関連付け時にCNAMEが自動作成される。外部DNSなら、Pages側で関連付けた後に`<選んだサブドメイン>`から`<project>.pages.dev`へのCNAMEを作る。CNAMEだけを先に手作業で追加しない。

本番確認:

- HTTPSと証明書
- iPhone Safari／Android ChromeでGPS、追加インストール、共有
- 320px／390px／タブレット／PC、ライト／ダーク、文字拡大
- `noindex`、CSP、位置送信先が設計どおり
- 独自ドメインからのService Worker更新通知

## 5. ロールバック

障害時は新しい修正を急いで積まず、Cloudflare Pagesの`Deployments`から直前の正常な本番deploymentを選び、`Rollback to this deployment`を実行する。Cloudflareの[Pages Rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)では、成功済みの本番deploymentだけが対象で、Preview deploymentは直接のロールバック先にならない。

ロールバック後:

1. 独自ドメインと`pages.dev`の両方を確認する。
2. `mvp-*`版と更新通知を確認する。
3. 原因修正は新しいPRで行う。
4. 静的データ不具合なら生成物とmanifestを同じコミット単位で戻す。

## 6. 全国データ更新

```powershell
npm.cmd run data:municipalities
npm.cmd run data:stations
npm.cmd run data:government
npm.cmd run data:medical
npm.cmd run data:validate
npm.cmd run check
npm.cmd run test:e2e
```

生成物だけでなくmanifest、取得元URL、基準日、除外件数、出典表示を同じPRで更新する。件数が大きく減少した場合は公開せず、原典の列変更・配布条件・座標欠損を先に確認する。

## 7. 費用を発生させない境界

- 独自サーバー、DB、認証、有料地図APIを追加しない。
- Cloudflare PagesとGitHubの無料範囲を使い、課金プランへの変更は本手順の範囲外とする。
- Cloudflare Web Analytics、広告、外部監視は有効にしない。
- 無料枠や利用条件が変わった場合は、公開継続前に要件を再確認する。
