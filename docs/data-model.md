# データモデル

## 1. 方針

独自サーバーとDBは持たない。利用者由来データは端末内、全国共通データはビルド時に生成した静的JSONへ分離する。生のGPS値は取得処理中のメモリーでのみ使い、永続化・外部送信時は用途別に精度を下げる。

## 2. 保存領域

| 領域 | 用途 | 内容 |
|---|---|---|
| メモリー | 現在の処理 | 生GPS、進行中の取得状態。再読込で消える |
| IndexedDB | 最新1件と短期キャッシュ | LocationSnapshot、ResourceCacheEntry。latest-dashboardストアは将来の互換用に予約 |
| localStorage | 小さな設定 | AppSettings、保存形式版 |
| Cache Storage | PWA資産 | HTML、JS、CSS、フォント、アイコン。全国JSONは容量を抑えるためprecacheしない |
| public/data | ビルド成果物 | 役所、駅、医療、出典、データ版 |

## 3. 共通型

### 3.1 ISO日時

- 型: string
- 形式: UTCのISO 8601（例 2026-08-11T05:32:10Z）
- 表示: Asia/Tokyoへ変換
- 禁止: タイムゾーンを含まない日時文字列の保存

### 3.2 Coordinates

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| latitude | number | ○ | WGS84、-90〜90 |
| longitude | number | ○ | WGS84、-180〜180 |

### 3.3 CardState

idle / loading / fresh / cached / stale / error / not_applicable のいずれか。

## 4. 端末内データ

### 4.1 AppSettings

localStorageキー: imakoko-info:settings

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| schemaVersion | integer | ○ | 設定形式版 |
| onboardingAccepted | boolean | ○ | 初回説明の確認状態 |
| installPromptSeen | boolean | ○ | PWAインストール案内の表示済み状態。旧形式ではfalseを補完 |
| expandedCards | string[] | ○ | 展開中カードID。位置情報を含まない |
| theme | system/light/dark | ○ | 初期値system |
| lastSeenAppVersion | string | ○ | 更新案内判定用 |

設定自体に座標、地名、医療機関名を含めない。

### 4.2 LocationSnapshot

IndexedDBストア: latest-location、キー: latest

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| schemaVersion | integer | ○ | 保存形式版 |
| coordinates | Coordinates | ○ | 小数点以下4桁へ丸めた最新1地点 |
| accuracyMeters | number | ○ | ブラウザが返した精度 |
| acquiredAt | ISO日時 | ○ | GPS確定時刻 |
| expiresAt | ISO日時 | ○ | acquiredAtから24時間 |

新規取得時に上書きし、履歴配列へ追加しない。期限超過時は削除する。

### 4.3 DashboardSnapshot（将来予約）

IndexedDBストア: latest-dashboard、キー: latest。MVPではストアだけ作成し、前回表示はLocationSnapshotと各ResourceCacheEntryから復元する。これにより集約スナップショットと個別キャッシュの二重書込み競合を避ける。

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| schemaVersion | integer | ○ | 保存形式版 |
| appVersion | string | ○ | 作成したアプリ版 |
| location | LocationSnapshot | ○ | 基準位置 |
| place | PlaceSummary | - | 地名・行政区域 |
| weather | WeatherSummary | - | 天気カード正規化値 |
| solar | SolarSummary | - | 日の出・日の入り |
| tide | TideSummary | - | 概算潮汐。対象外なら保存しない |
| government | GovernmentSummary | - | 県庁・管轄役所 |
| station | StationSummary | - | 最寄り駅と次候補 |
| medical | MedicalSummary | - | 表示済み医療機関 |
| createdAt | ISO日時 | ○ | スナップショット作成時刻 |
| expiresAt | ISO日時 | ○ | 最大24時間 |

外部APIの生レスポンスをそのまま保存しない。画面表示に必要な最小値だけを保持する。

### 4.4 ResourceCacheEntry

IndexedDBストア: resource-cache、キー: resourceType

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| resourceType | place/weather/solar/tide/government/station/medical | ○ | 一意キー。同種の最新1件 |
| origin | Coordinates | ○ | 丸め済み基準地点 |
| payload | object | ○ | Zod検証後の正規化値 |
| fetchedAt | ISO日時 | ○ | 取得時刻 |
| freshUntil | ISO日時 | ○ | fetchedAtから15分 |
| staleUntil | ISO日時 | ○ | 最大24時間 |
| provider | string | ○ | 提供元識別子 |
| dataVersion | string | - | 静的データ版 |

再利用条件:

- place/government/station/medical: originから250m以内かつfreshUntil以前
- weather/solar/tide: originから1km以内かつfreshUntil以前
- freshUntil超過かつstaleUntil以前: 自動的には現在値扱いせず、前回値として表示可能
- staleUntil超過: 削除し、表示へ使わない

## 5. 正規化された表示データ

### 5.1 PlaceSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| municipalityCode | string | ○ | 5桁コード。検査数字はマスター側で保持可 |
| prefectureName | string | ○ | 都道府県名 |
| municipalityName | string | ○ | 市区町村名 |
| wardName | string | - | 政令指定都市の区等 |
| localityName | string | - | 町丁目 |
| displayName | string | ○ | 画面用の連結済み名称 |
| boundaryCaution | boolean | ○ | GPS精度・再取得差分から注意表示するか |
| providerFetchedAt | ISO日時 | ○ | 取得時刻 |

### 5.2 WeatherSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| weatherCode | integer | ○ | WMO天気コード |
| temperatureC | number | ○ | 現在気温 |
| apparentTemperatureC | number | ○ | 体感温度 |
| todayMaxC | number | ○ | 今日の最高気温 |
| todayMinC | number | ○ | 今日の最低気温 |
| todayMaxHourlyPrecipitationMm | number | ○ | 今日の時間別予想降水量の最大値（mm） |
| elevationMeters | number | - | API格子の概算標高（m）。欠損時は標高だけを非表示にし、天気・現在地を維持 |
| nextSixHours | HourlyWeather[] | ○ | 現在時刻以降の最大6件 |
| modelCoordinates | Coordinates | ○ | APIが使用した格子中心 |
| fetchedAt | ISO日時 | ○ | 取得時刻 |

`HourlyWeather.precipitationMm`は表示時刻までの直前1時間の予想降水量（mm）とする。降水確率は保存・表示しない。旧形式の天気キャッシュは読込時に不適合として削除し、新規取得する。

### 5.3 SolarSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| localDate | YYYY-MM-DD | ○ | JSTの対象日 |
| sunriseAt | ISO日時 | ○ | UTC正規化して保持 |
| sunsetAt | ISO日時 | ○ | UTC正規化して保持 |
| fetchedAt | ISO日時 | ○ | 取得時刻 |

### 5.4 TideSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| modelCoordinates | Coordinates | ○ | Marine APIが返した海洋格子中心 |
| distanceMeters | number | ○ | 現在地から格子中心までの直線距離 |
| events | TideEvent[] | ○ | 直近の極大・極小。時刻順 |
| fetchedAt | ISO日時 | ○ | 取得時刻 |
| disclaimerCode | approximate-not-for-navigation | ○ | 表示免責識別子 |

TideEvent:

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| kind | high/low | ○ | 極大／極小 |
| occurredAt | ISO日時 | ○ | 推定時刻 |
| seaLevelHeightMsl | number | ○ | 全球平均海面基準のモデル値。潮位として強調表示しない |

### 5.5 GovernmentSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| prefecturalOffice | NearbyOffice | ○ | 都道府県庁 |
| jurisdictionOffice | NearbyOffice | ○ | 管轄役所。区がある場合は区役所優先 |
| parentCityOffice | NearbyOffice | - | 政令指定都市の市役所補助導線 |
| dataVersion | string | ○ | 役所マスター版 |

### 5.6 StationSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| searchRadiusKm | 30 | ○ | 検索上限半径 |
| stations | NearbyStation[] | ○ | 距離順、最大3件 |
| dataVersion | string | ○ | 駅データ基準日 |
| sourceNotice | string | ○ | 直線距離・静的データである旨 |

NearbyStation:

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ○ | 生成した駅グループID |
| name | string | ○ | 駅名 |
| lines | StationLine[] | ○ | 路線名と運営会社。重複排除済み |
| coordinates | Coordinates | ○ | 駅グループの代表座標 |
| distanceMeters | number | ○ | 現在地からの直線距離 |
| bearingDegrees | number | ○ | 初期方位角 |
| direction8 | string | ○ | 8方位表示 |

### 5.7 MedicalSummary

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| searchRadiusKm | 10/30 | ○ | 実際に使った半径 |
| hospitals | NearbyMedicalFacility[] | ○ | 最大3件 |
| clinics | NearbyMedicalFacility[] | ○ | 最大3件 |
| dentalClinics | NearbyMedicalFacility[] | ○ | 最大3件、折りたたみ |
| pharmacies | NearbyMedicalFacility[] | ○ | 最大3件、折りたたみ |
| midwiferyCenters | NearbyMedicalFacility[] | ○ | 最大3件、折りたたみ |
| dataVersion | string | ○ | 医療データ基準日 |
| sourceNotice | string | ○ | 最新性を保証しない旨 |

## 6. 静的マスター

### 6.1 MunicipalityRecord

ファイル: src/data/municipalities.generated.json（国土地理院の自治体コード一覧から生成し、アプリ本体へ同梱）

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| code | string | ○ | 自治体コード |
| prefectureName | string | ○ | 都道府県名 |
| municipalityName | string | ○ | 市区町村名。指定都市区では親市名 |
| wardName | string | - | 指定都市の区名 |

### 6.2 OfficeRecord

ファイル: public/data/government/offices.json

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ○ | 安定ID。自治体コード＋庁舎種別 |
| municipalityCode | string | ○ | 所属団体 |
| officeType | prefectural/city/ward/town/village | ○ | 庁舎種別 |
| name | string | ○ | 正式名称 |
| coordinates | Coordinates | ○ | ビルド時に住所から取得し目視検査 |
| officialUrl | URL | ○ | 公式サイト |
| sourceAddress | string | ○ | 距離計算用座標の検証根拠。画面には出さない |
| sourceUrl | URL | ○ | J-LISまたは自治体公式根拠 |
| checkedAt | YYYY-MM-DD | ○ | 確認日 |

### 6.3 StationGroupRecord

ファイル: public/data/stations/{gridId}.json

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ○ | 正規化駅名とクラスタから生成する安定ID |
| name | string | ○ | 駅名 |
| coordinates | Coordinates | ○ | 構成レコード座標の代表点 |
| lines | StationLine[] | ○ | 路線名、運営会社、事業者種別 |
| sourceRelationIds | string[] | ○ | N05関係ID。原典追跡用 |
| installedStartYear | integer | ○ | 最古の設置開始年。不明は999 |
| installedEndYear | 9999 | ○ | 現存扱いだけを配布 |
| sourceNote | string | - | 位置精度・変遷の注記 |
| dataVersion | YYYY-MM-DD | ○ | 原典データ基準日 |

StationLine:

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| lineName | string | ○ | N05_002 路線名 |
| operatorName | string | ○ | N05_003 運営会社 |
| operatorType | string | ○ | N05_001 事業者種別 |

生成時は設置終了年9999の駅レコードだけを採用し、変遷備考等で休止と確認できるレコードは除外する。同じ正規化駅名で座標間が200m以内のレコードを1駅グループにまとめ、路線と運営会社を重複排除する。200mを超える同名駅は別グループとし、誤結合を避ける。

### 6.4 StationManifest

ファイル: public/data/stations/manifest.json

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| dataVersion | YYYY-MM-DD | ○ | 国土数値情報のデータ基準日 |
| sourceDataset | N05 | ○ | データ識別子 |
| schemaVersion | integer | ○ | JSON形式版 |
| gridSizeDegrees | number | ○ | 0.25 |
| sourceFeatureCount | integer | ○ | 原典駅レコード総数 |
| adoptedSourceRecordCount | integer | ○ | 現存扱いとして採用した原典駅レコード数 |
| excluded | object | ○ | 終了・休止・不正による除外件数 |
| stationGroupCount | integer | ○ | グルーピング後の駅数 |
| generatedAt | ISO日時 | ○ | UTC |
| sourceUrls | URL[] | ○ | 原典・個別利用条件 |
| usageRestriction | non-commercial | ○ | 再配布・利用条件の表示用 |
| checksum | string | ○ | 生成物集合の検査値 |

検索時は30kmの外接矩形と交差する0.25度グリッドだけを取得し、Haversine距離で30km以内を絞り、距離順の最大3件を返す。

### 6.5 MedicalFacilityRecord

ファイル: public/data/medical/{gridId}.json

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | string | ○ | 原典施設ID |
| type | hospital/clinic/dental/pharmacy/midwifery | ○ | 正規化区分 |
| name | string | ○ | 施設名 |
| coordinates | Coordinates | ○ | 原典座標 |
| officialUrl | URL | - | 施設公式サイト |
| sourceDetailUrl | URL | - | 医療情報ネットの施設詳細導線が構成可能な場合 |
| prefectureCode | string | ○ | 地域検査用 |
| municipalityCode | string | ○ | 地域検査用 |
| sourceUpdatedAt | YYYY-MM-DD | ○ | 原典基準日 |

住所、電話、診療時間、診療科はMVP表示に不要なため、初期の配布JSONへ含めない。将来機能で必要になった時点で要件を改訂する。

### 6.6 MedicalManifest

ファイル: public/data/medical/manifest.json

| 項目 | 型 | 必須 | 説明 |
|---|---|---|---|
| dataVersion | YYYY-MM-DD | ○ | 厚生労働省公開版の基準日 |
| schemaVersion | integer | ○ | JSON形式版 |
| gridSizeDegrees | number | ○ | 0.25 |
| facilityCounts | Record<type, number> | ○ | 全国件数 |
| grids | Record<gridId, number> | ○ | 分割ファイルごとの件数 |
| accounting | object | ○ | 原典、生成、座標欠損等の除外件数 |
| generatedAt | ISO日時 | ○ | UTC |
| sourceUrls | URL[] | ○ | 原典 |
| checksum | string | ○ | 生成物集合の検査値 |

検索時はまず10kmの外接矩形と交差する0.25度グリッドだけを取得する。病院・一般診療所のどちらかが3件未満の場合だけ30kmの外接矩形との差分ファイルを追加取得し、Haversine距離で厳密に10km／30kmを絞り込む。

## 7. 距離・方角

- 距離はWGS84座標のHaversine直線距離とする。
- 方角は初期方位角を8方位へ丸め、矢印と日本語を併記する。
- NaN、範囲外座標、同一点は明示的に処理する。
- 1km未満は10m単位を目安にm表示、1km以上は小数1桁km表示とする。GPS精度より細かな精度を示唆しない。

## 8. ライフサイクル

| 対象 | 作成 | 更新 | 期限超過 | 削除 | 復元 |
|---|---|---|---|---|---|
| 生GPS | 測位成功 | 再測位 | 即時破棄 | メモリー解放 | 不可 |
| LocationSnapshot | 測位成功 | 最新1件で上書き | 24時間で削除 | 全消去／自動削除 | 不可 |
| DashboardSnapshot | MVPでは未使用 | - | - | 全消去 | 将来予約 |
| ResourceCache | 取得成功 | 同種1件を上書き | 15分後stale、24時間後削除 | 全消去／自動削除 | 外部から再取得 |
| 役所マスター | ビルド時生成 | 半年確認・変更時 | 旧版を表示し更新日を明示 | 新版確認後に置換 | Gitで前版復元 |
| 駅マスター | 国土数値情報から生成 | 公式版更新時 | 基準日を明示して継続利用 | 新版確認後に置換 | Gitで前版復元 |
| 医療マスター | 公式版から生成 | 公式版更新時 | 基準日を明示して継続利用 | 新版確認後に置換 | Gitで前版復元 |
| PWA資産 | ビルド時 | 新版通知後に切替 | 旧版を破棄 | SW更新処理 | Cloudflareで前版復元 |

## 9. 保存形式の移行

- schemaVersionが現行と一致すれば読み込む。
- 互換移行が小さい場合は純粋関数で変換し、テストする。
- 安全に移行できない場合は、利用者由来キャッシュを削除して再取得する。
- 破損JSON、未知の列挙値、期限不正は読み飛ばし、全画面を停止しない。

## 10. 全消去

全消去操作は次を順に実行する。

1. latest-location、latest-dashboard、resource-cacheを削除
2. AppSettingsを初期化
3. 利用者由来データの削除完了を表示
4. アプリ資産キャッシュは動作継続のため残し、次回更新処理で管理

削除中の二重操作は同じ完了結果になるよう冪等にする。
