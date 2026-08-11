# いまここインフォ

シクミラボが運営する「いまここインフォ」の要件・基本設計とPWA実装です。

## 読む順番

1. 基本設計サマリ.md
2. docs/screens.md
   - 現行画面モック: docs/mockups/mobile-dashboard-light-v4.png
3. docs/data-model.md
4. docs/api-design.md
5. docs/tasks.md
6. AGENTS.md（Codex向け実装規約）
7. THIRD_PARTY_NOTICES.md（同梱データ・フォントの表示）

要件の正典は、ルートの要件定義書_いまここインフォ.mdです。

## 状態

- 要件定義: 完了（1.7、概算標高・ブランド表記・現在日付／時計・小杉ゴシック・FR-016 最寄り駅を含む）
- 基本設計: 完了（1.6）
- MVP実装: 完了（GPS、地名、天気、太陽、概算標高・潮汐、駅、役所、医療、共有、端末内保存、PWA更新）
- 自動検証: 型検査、単体・結合72件、Playwright E2E 7件、全国静的データ全件検査、本番ビルドが成功
- 本番公開: https://imacoco.sikumilab.com/

## 開発コマンド

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run check
npm.cmd run test:e2e
```

`npm.cmd run check`は版整合、全国静的データ、型、単体・結合テスト、本番ビルドを検証します。公開・更新・ロールバック手順は[docs/deployment.md](docs/deployment.md)を参照してください。
