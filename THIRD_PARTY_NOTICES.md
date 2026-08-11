# 第三者データ・ソフトウェア表示

「いまここインフォ」mvp-0.1.0が同梱・参照する主な第三者資産を記録する。各権利は提供者に帰属する。

## 同梱データ

| 対象 | 提供元・条件 | 本版の基準日／件数 |
|---|---|---|
| 駅 | 国土交通省「国土数値情報（鉄道時系列データ N05）」[データ詳細・個別利用条件](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N05-2025.html)。本アプリは非商用利用 | 2025-12-31、9,119駅グループ |
| 役所 | [アマノ技研 全国市町村役場データ](https://amano-tec.com/data/localgovernments.html)。同梱readmeの「フリーソフト・転載配布可」に基づく。公式確認先に[デジタル庁](https://www.digital.go.jp/resources/data_local_governments)と[J-LIS](https://www.j-lis.go.jp/spd/map-search/cms_1069.html)を併用 | 2026-01-15、1,960庁舎 |
| 医療機関 | 厚生労働省「[医療情報ネットのオープンデータ](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html)」、公共データ利用規約（第1.0版） | 2026-06-01、189,800施設 |
| 自治体名・コード | 国土地理院 逆ジオコーダーが返す自治体コード一覧を生成時に取得 | 1,919自治体 |

加工内容、原典URL、採用・除外件数、checksumは`public/data/*/manifest.json`と`scripts/validate-static-data.mjs`で追跡する。

## 実行時に参照するサービス

- 国土地理院 逆ジオコーダー: 地名・行政区域。小数4桁へ丸めた座標を送信。
- Open-Meteo Weather API: 天気、太陽、概算標高。小数2桁へ丸めた座標を送信。
- Open-Meteo Marine API: 潮の目安。小数2桁へ丸めた座標を送信。

## フォント

Kosugi font package (`@fontsource/kosugi`): Apache License 2.0。Copyright 2010 The Kosugi Project Authors。アプリへ同梱し、外部フォント配信には接続しない。

## アプリ本体

公開GitHubリポジトリであること自体は、アプリ本体へ第三者が再利用できるライセンスを付与するものではない。明示的なライセンスファイルが追加されるまでは、著作権は`© 2026 SIKUMI LAB`に留保される。
