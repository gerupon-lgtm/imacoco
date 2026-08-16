# Open-Meteo 降水表示の精度・整合性改善案（2026-08-17）

> 決定（2026-08-17）: 利用者との検討により、降水確率は表示せず、`best_match`の`hourly.precipitation`を使う方式を採用した。上段は今日の最大1時間予想降水量、直近6時間は各時刻までの直前1時間予想降水量を表示する。以下は決定前の比較検討記録として残す。

## 調査目的

利用者提供の調査資料を検討材料として、当時の降水確率表示を Open-Meteo の範囲内で改善できるかを確認した。ここでは次を分けて扱う。

- **予報精度**: 実際に雨が降ったかに対して予報がどれだけ当たるか
- **表示整合性**: 同じ時刻欄の「晴れ」「降水確率」「予想降水量」が利用者に矛盾して見えないか

## 結論

1. `models=jma_msm` へ変えるだけでは、降水**確率**の精度は上がらない。JMA MSM は約5 km・1時間間隔の決定論的予報だが、JMA API は `precipitation_probability` を提供していない。
2. 現行の `best_match` は単純な全球モデルではない。Open-Meteo は地点ごとに適用可能な高解像度モデルを自動選択し、公式実装では日本向けに JMA MSM などの決定論モデルと GFS・IFS 系の降水確率リーダーを組み合わせている。この異種モデル併用が「晴れなのに90%」の主な構造的要因になり得る。
3. 採用方針は、`best_match` を維持したまま既存の1リクエストで `precipitation` を取得し、降水確率を廃止して予想降水量だけを表示すること。決定論的な天気状態と降水量を同じ応答に揃え、利用者に矛盾して見える組み合わせを避ける。
4. 数値精度の改善を断定するには、地域・予報時間帯ごとに過去予報と観測実績を照合する必要がある。モデル固定や独自閾値は、バックテストなしに「高精度」とは言えない。

## 検討時の実装

`src/providers/openMeteo.ts` は、汎用 Forecast API の `best_match`（`models` 未指定）を1回呼び出している。

```text
current = temperature_2m, apparent_temperature, weather_code
hourly  = temperature_2m, precipitation_probability, weather_code
daily   = temperature_2m_max, temperature_2m_min,
          precipitation_probability_max, sunrise, sunset
```

時刻配列と各値は同じ添字で正規化されており、前回調査でも配列ずれやJST変換ミスは確認されていない。現在の違和感は表示処理の転記ミスではなく、取得元の変数が異なる時間範囲・モデル解像度を持つことから生じている。

## 添付資料の評価

### 確認できた内容

- 標準 `precipitation_probability` は、表示時刻までの直前1時間に **0.1 mmを超える降水**がある確率である。
- 確率は約0.25度（約27 km）のアンサンブル、30シミュレーションに基づく。
- JMA MSM は日本周辺で約5 km、1時間間隔、4日先、3時間ごとに更新される。
- Ensemble API から各メンバーの `precipitation` を取得し、任意閾値を超えたメンバー比率を独自指標にすることは技術的に可能である。

出典: [Open-Meteo Weather Forecast API](https://open-meteo.com/en/docs)、[Open-Meteo JMA API](https://open-meteo.com/en/docs/jma-api)、[Open-Meteo Ensemble API](https://open-meteo.com/en/docs/ensemble-api)

### 補正が必要な内容

#### 1. `best_match` は「通常の全球モデル」ではない

Open-Meteo は、各地点で利用可能な最高解像度モデルを自動選択・結合すると説明している。さらに公式実装は、日本領域で JMA MSM、ICON、全球モデルを並べ、GFS・IFS 系の確率リーダーも同じ reader 群へ組み込んでいる。したがって、決定論的な `weather_code` と `precipitation` は日本向け高解像度モデル、`precipitation_probability` は広域アンサンブル、という組み合わせになり得る。

出典: [Forecast API Data Sources](https://open-meteo.com/en/docs)、[Open-Meteo公式実装 `ForecastapiController.swift`（2026-08-17確認時点）](https://github.com/open-meteo/open-meteo/blob/5fcb53297b1726692e9b8aaf5aaba921168b67cb/Sources/App/Controllers/ForecastapiController.swift)

#### 2. JMA MSM単独では降水確率を返せない

JMA API の時間別変数一覧には `precipitation` と `weather_code` はあるが、`precipitation_probability` はない。公式実装でも `jma_msm` の `precipitationProb` は `nil` である。

2026-08-17に公開地点を使って公式APIを確認したところ、`models=jma_msm` で `precipitation_probability` を要求すると、単位は `undefined`、各値は `null` だった。`precipitation` と `weather_code` は取得できた。

出典: [Open-Meteo JMA API](https://open-meteo.com/en/docs/jma-api)、[Open-Meteo公式実装（2026-08-17確認時点）](https://github.com/open-meteo/open-meteo/blob/5fcb53297b1726692e9b8aaf5aaba921168b67cb/Sources/App/Controllers/ForecastapiController.swift)

#### 3. 独自閾値は「精度向上」ではなく「指標変更」

Ensemble APIで `0.5 mm以上` や `1.0 mm以上` のメンバー比率を計算すれば、標準の0.1 mm超より低い確率になりやすい。ただし、それは「降水確率」の精度を高めたのではなく、対象事象を「より強い雨」に変更したものになる。表示する場合は、`1mm以上の雨の可能性` など、標準降水確率と区別した名称が必要である。

また、現在掲載されている Ensemble API のモデル一覧には日本専用JMAアンサンブルがなく、日本で利用できる主な全球アンサンブルは約20〜40 km級である。JMA MSMの約5 kmより粗く、独自計算だけで局地降水の精度向上は保証できない。

出典: [Open-Meteo Ensemble API — Models and Data Sources](https://open-meteo.com/en/docs/ensemble-api)

## 改善案の比較

| 案 | 内容 | 予報精度 | 表示整合性 | HTTPリクエスト | 通信・実装負荷 | 評価 |
|---|---|---|---|---:|---|---|
| A | `best_match`の同一応答へ`precipitation`を追加し、確率とmmを併記 | 変わらない | 改善する | 1回のまま | 小 | **推奨** |
| B | JMA MSMへ固定し、確率をやめて予想降水量だけ表示 | 未検証。局地解像度は高いが、現行best_matchも日本でJMA MSMを利用 | モデル内では揃う | 1回 | 中。要件・UI変更あり | 条件付き |
| C | 決定論とアンサンブルを同系列モデルへ固定 | バックテスト前は不明。JMA MSMを外す可能性 | 改善し得る | 1回または複数モデル指定 | 中〜大 | 実験候補 |
| D | Ensemble APIで0.5/1.0 mm超の確率を独自計算 | バックテスト前は不明 | 指標の意味は明確化できる | 既存に加えて1回 | 大。多数メンバー配列 | MVPには非推奨 |

### A案の具体像

既存の時間別指定を次のようにする。

```text
hourly=temperature_2m,precipitation_probability,precipitation,weather_code
```

表示例:

```text
21:00  晴れ
雨の可能性 92%（広域予報）
予想降水量 0.0 mm
```

ここで `92%` を `0%` に補正したり非表示にしたりはしない。決定論モデルが0.0 mmでも、アンサンブルが示す不確実性は別情報として残す。これにより情報を改変せず、なぜ値が異なるかをUI上で説明できる。

### B案の注意点

JMA MSMの `weather_code` はJMAが直接配布する天気コードではなく、Open-Meteoが雲量・降水・雪から算出した値である。またJMA MSMには正規の降水確率がないため、予想降水量から0〜100%へ独自換算してはならない。

出典: [Open-Meteo JMA API — Derived Variables](https://open-meteo.com/en/docs/jma-api)

## コストと通信量

- 非商用のFree/Open-Accessは、600回/分、5,000回/時、10,000回/日、300,000回/月で、稼働保証はない。
- 通常は1 HTTPリクエストが1 API callだが、10変数超、2週間超、複数地点・複数モデルなどでは換算コール数が増える場合がある。
- A案はHTTPリクエスト数を増やさず、時間別配列を1本追加するだけなので、通信量増加は小さい。現行リクエスト自体が複数のcurrent/hourly/daily変数を指定しているため、正確な換算コール数はOpen-Meteoの計算規則に従う。
- D案は別の Ensemble API 呼び出しが必要で、GFS 0.25°なら制御メンバーを含む31系列程度を受け取る。6時間だけでもA案より応答が大きく、無料枠・端末通信量・正規化処理のすべてに不利である。

出典: [Open-Meteo Pricing](https://open-meteo.com/en/pricing)、[Open-Meteo Ensemble API](https://open-meteo.com/en/docs/ensemble-api)

## 本当に予報精度を上げるために必要な検証

Open-Meteoは個別モデルの選択・比較と過去予報APIを提供するが、「日本全国で常にこのモデルが最良」という保証はしていない。実装へ固定する前に、少なくとも次を地域別・予報リードタイム別に測る必要がある。

1. 現行の標準降水確率
2. GFS・IFSなど候補アンサンブルの確率
3. JMA MSMの予想降水量
4. 同じ時間区間の観測降水実績

確率予報は Brier score と信頼度図、降水量は MAE などで評価する。過去予報の取得には Open-Meteo の Previous Runs / Single Runs APIを利用できるが、最終的な正解データには観測値が必要であり、モデル再解析値だけで「実際に当たった」とは断定しない。

出典: [Open-Meteo Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api)、[Open-Meteo Previous Runs API](https://open-meteo.com/en/docs/previous-runs-api)、[Open-Meteo Single Runs API](https://open-meteo.com/en/docs/single-runs-api)

## 採用方針

比較後の利用者判断により、次の方針を採用した。

1. `best_match` は維持する。
2. 同じForecast APIリクエストで時間別 `precipitation` を取得する。
3. 降水確率は保存・表示せず、上段に今日の最大1時間予想降水量、展開部に直前1時間の予想降水量を表示する。
4. 予想降水量を観測値や確率へ独自換算しない。
5. 数値精度そのものを改善する段階では、一定期間のバックテスト後にモデルを検討する。

この方針なら、Open-Meteoのみ・追加APIキーなし・追加HTTPリクエストなしで、天気状態と確率値が矛盾して見える問題を解消できる。
