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

要件の正典は、ルートの要件定義書_いまここインフォ.mdです。

## 状態

- 要件定義: 完了（1.5、概算標高・ブランド表記・現在日付／時計・小杉ゴシック・FR-016 最寄り駅を含む）
- 基本設計: 完了（1.4）
- 実装: 着手済み（T-001/T-002/T-004の初期縦切り。現在は固定の東京サンプルデータで画面骨格を表示）
- 本番公開: 未実施

## 開発コマンド

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run check
```

現段階ではGPS・各外部データ取得は未接続です。日時表示、概算標高の正規化、カード順、レスポンシブ画面、PWA生成を先行実装しています。
