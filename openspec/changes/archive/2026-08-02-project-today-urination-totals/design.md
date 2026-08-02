## Context

首頁（`HomeOverviewHero` 與 `HomeInstantCards`）以注入的 device overview store 為唯一資料來源，該 store 對 `devices/{deviceId}` 開一個 Firestore snapshot listener，並用 `parseDeviceOverview` 把未受信任的文件驗證成 `DeviceOverviewProjection`。registry 文件目前只帶 `latestUrination*`、`latestBattery*`、`lastReportedAtMs` 三組投影，沒有任何今日彙總欄位，所以兩個元件把今日次數與今日尿量寫死成 `N/A`。

實際的今日數字存在另一個位置：ingestion 端每收到一筆排尿事件，就在同一個 Firestore transaction 內遞增 `devices/{deviceId}/dailyStats/{dayKey}` 的 `urinationCount` 與 `estimatedUrineTotalMl`，`dayKey` 以 Asia/Taipei 日界計算。

第二個問題是契約脫節。commit cb82b89 把每日文件從「`volumeStatus: 'pending_calibration'` 加四個恆為 null 的容積欄位」改成「單一 `estimatedUrineTotalMl` 實際加總」，但只更新了 ingestion 端實作與 ingestion 端測試。前端 `parseDailyStatsDocument` 仍要求舊 shape，因此任何在該 commit 之後寫入的每日文件都會讓統計頁丟出 `invalid_volume_status` 並顯示錯誤狀態。三份 spec（`daily-urination-counts`、`daily-urination-visualization`）與 `docs/mqtt-interfaces-and-firestore-models.md` 也仍描述舊 shape。前端測試沒有攔到，因為 fixture 同樣是舊 shape。

約束：client 對 Firestore 全面唯讀，所有寫入由 ingestion 端 Admin SDK 完成，`firestore.rules` 已允許 owner 讀取 `devices/{deviceId}`，因此新增欄位不需要調整安全規則。專案既有慣例是「缺值就顯示明確未知，絕不捏造 0 或從歷史推導」。

## Goals / Non-Goals

**Goals:**

- 首頁在既有的單一 device snapshot 內就能取得今日次數與今日尿量，並隨事件即時更新，不新增第二個 listener 或額外的 Firestore 讀取
- 遲到（out-of-order）事件不得讓今日投影倒退成更早日期的數字
- 跨日之後，前一日的投影不得被誤讀成今日數字
- 前端每日文件驗證契約與 ingestion 端實際寫出的文件一致，統計頁不再因契約脫節而進入錯誤狀態
- spec 與資料模型文件與實作同步

**Non-Goals:**

- 不實作「比昨天」的比較數字。即時卡片的兩個 footer 維持 `N/A`，因為那需要另外讀取昨日彙總，屬於後續變更
- 統計頁不新增每日尿量的顯示或圖表。本次只修正它的文件驗證契約，讓既有的次數視覺化不再被錯誤中斷
- 不回填 cb82b89 之前以舊 shape 寫入的既有每日文件
- 不觸碰事件層級 spec（`urination-event-persistence`、`device-event-history`）中同樣已與實作脫節的 `estimatedUrineMl: null` / `pending_calibration` 敘述。那是 commit 77a4047 留下的獨立文件債，與本次的每日彙總契約無關
- 不改動 `firestore.rules`

## Decisions

### 以 registry 文件的今日投影取代前端額外查詢 dailyStats

今日數字鏡射到 `devices/{deviceId}` 上，而不是讓首頁自己去讀 `devices/{deviceId}/dailyStats/{今日}`。

理由：首頁的即時卡片本來就期待隨事件更新，registry 文件已有 listener，鏡射後今日數字與 `latestUrination*` 在同一次 snapshot 一起到達，畫面不會出現「最近一次已更新、今日次數還是舊值」的撕裂。若改用前端查詢，要嘛只在進頁時讀一次（失去即時性），要嘛再開一個 dailyStats listener（多一條連線，且兩個 snapshot 之間仍有撕裂窗口）。

代價是同一份資料存在兩處。以「dailyStats 為權威、registry 投影為快取鏡射」界定：兩者在同一 transaction 內一起寫，投影的值一律取自該 transaction 剛算出的每日紀錄，不獨立累加，因此不會各自漂移。

### 今日投影的欄位組成

registry 文件新增三個欄位，構成一組必須完整的 tuple：

- `todayDate`：字串，`yyyy-MM-dd`，Asia/Taipei 當地日期
- `todayUrinationCount`：非負安全整數
- `todayEstimatedUrineTotalMl`：非負有限數

必須帶上 `todayDate`，否則讀取端無從判斷這組數字屬於哪一天，跨日後會把昨天的數字當成今天。三個欄位一起寫、一起讀，沿用既有 latest tuple 的「完整或全無」慣例。

### 遲到事件以日界字串比較決定是否覆寫投影

只有當事件的 `dayKey` 不早於文件現有的 `todayDate` 時才覆寫三個欄位；`dayKey` 較早時只遞增 dailyStats，投影原封不動。`yyyy-MM-dd` 固定寬度、Latin 數字，字典序即時間序，不需要額外解析成日期。

替代方案是比較 `lastEventAtMs`，但那是 epoch 毫秒與日界的混用，跨日邊界附近容易出現「較晚的 epoch 卻屬於較早日界」以外的推理錯誤，字串日界比較語意更直接。

### 跨日過期由讀取端判定，並解讀為當日 0

讀取端以瀏覽端當下的 Asia/Taipei 日期比對 `todayDate`：

- 相等：直接採用投影的次數與總量
- 不相等（投影停在更早的日期）：解讀為今日尚無排尿事件，回傳 0 次、0 mL

第二條看似違反「不捏造 0」的專案慣例，但這裡的 0 是資料支持的推論而非猜測：ingestion 端對每一筆排尿事件都會更新投影，因此若投影仍停在昨天，就代表今天確實沒有任何事件被記錄。相對地，若讓過期投影顯示 `N/A`，使用者在每天午夜到第一次排尿之間都會看到未知狀態，那才是資訊的遺失。

由讀取端而非寫入端判定過期，是因為沒有事件時 ingestion 端不會被喚醒，無法主動把跨日的投影歸零。

### 三欄位完全缺席才是未知，部分缺席是完整性錯誤

三個欄位都不存在時回傳 `null`，代表這個裝置從未有過排尿事件，UI 顯示 `N/A`。只要其中任一存在而其他缺席、或型別／格式不合（`todayDate` 非 `yyyy-MM-dd`、次數非非負安全整數、總量非非負有限數），一律丟 `DeviceOverviewIntegrityError`，與既有 `partial_urination_tuple`／`partial_battery_tuple` 的處理方式一致，讓資料缺陷大聲失敗而不是靜默顯示成半可用的卡片。

### 前端每日文件契約向 ingestion 現況對齊

修正方向是把 `parseDailyStatsDocument` 改成接受 ingestion 端實際寫出的 shape，而不是把 ingestion 端改回 `pending_calibration`。校正公式已經實作（`persistence/urine-volume-estimate.ts`），加總是有意義的真實數值，回退等於丟掉已完成的功能。

`volumeStatus`、`estimatedUrineAverageMl`、`estimatedUrineMinMl`、`estimatedUrineMaxMl` 這四個欄位在新 shape 中不存在，驗證器不再檢查它們；`estimatedUrineTotalMl` 從「必須是 null」改為「必須是非負有限數」。連帶移除 `invalid_volume_status` 與 `invalid_volume_contract` 兩個完整性代碼，新增 `invalid_estimated_urine_total_ml`。

### 不做既有每日文件的回填

舊 shape 的每日文件在新契約下會被前端驗證器拒絕。這在 ingestion 端其實已是現況：`assertValidDailyDocument` 目前就會對舊文件丟 `AggregationIntegrityError`，該日後續事件一律寫不進去。開發環境的處置是清掉舊資料重跑，不寫回填程式。正式環境尚未部署過帶資料的版本，沒有回填對象。

## Implementation Contract

**行為（ingestion 端）**

排尿事件成功寫入時，`devices/{deviceId}` 文件除了既有的 `latestUrination*` 與 `lastReportedAtMs` 投影，另外帶有 `todayDate`、`todayUrinationCount`、`todayEstimatedUrineTotalMl` 三個欄位，其值等於同一 transaction 內剛寫入的 `devices/{deviceId}/dailyStats/{dayKey}` 文件的 `date`、`urinationCount`、`estimatedUrineTotalMl`。電量事件不寫這三個欄位。

投影更新規則以一個純函式表達，輸入為「文件現有的 `todayDate`（可能不存在）」與「本次事件的每日紀錄」，輸出為「要併入 registry 更新的欄位物件」：現有 `todayDate` 不存在、或每日紀錄的 `date` 不早於它時，輸出三個欄位；否則輸出空物件。函式不接觸 Firestore，可獨立測試。

重複事件（`duplicate`）、`unknown_device`、`device_disabled`、`product_model_mismatch` 這些既有結果不新增寫入，投影維持原值。

**行為（Web 端）**

`parseDeviceOverview` 回傳的 `DeviceOverviewProjection` 新增 `today` 欄位，型別為 `{ date: string; urinationCount: number; estimatedUrineTotalMl: number } | null`，並提供一個以「目前時刻」為參數的解析函式，回傳今日應顯示的次數與總量：投影為 `null` 時回傳未知；`date` 等於參數時刻的 Asia/Taipei 日期時回傳投影值；否則回傳 0 次、0 mL。以參數注入時刻而非直接讀 `Date.now()`，讓跨日行為可測。

`HomeOverviewHero` 的標題與今日尿量 pill、`HomeInstantCards` 的今日尿量與今日次數兩張卡改用該結果；未知時仍顯示 `N/A`。即時卡片的兩個 footer 維持 `N/A`。

`parseDailyStatsDocument` 接受不含 `volumeStatus` 與 average／min／max 欄位、且 `estimatedUrineTotalMl` 為非負有限數的文件，並在 `estimatedUrineTotalMl` 不合規時以 `invalid_estimated_urine_total_ml` 失敗。

**失敗模式**

- registry 今日投影部分缺席或格式不合 → `DeviceOverviewIntegrityError`，新增代碼 `partial_today_tuple` 與 `invalid_today_totals`，首頁顯示既有的可重試錯誤狀態，不顯示半套卡片
- 每日文件不符新契約 → `DailyStatsDataIntegrityError`，統計頁顯示既有錯誤狀態
- ingestion 端每日文件完整性失敗 → 維持既有的 `aggregation_integrity_error` 結果與 transaction 中止行為，不因新投影而改變

**驗收條件**

- ingestion 端：新的投影純函式有涵蓋「無現有投影」「同日更新」「較新日期覆寫」「較早日期不覆寫」四種情形的單元測試；`firestore-event-sink` 的整合測試斷言排尿事件後 registry 文件帶有三個今日欄位且值與 dailyStats 一致，電量事件後不出現這三個欄位
- Web 端：`device-overview-model` 的測試涵蓋完整投影、完全缺席、部分缺席、格式錯誤、以及「投影日期為昨日時解讀為 0」；`HomeView` 的測試斷言今日次數與今日尿量呈現投影數值而非 `N/A`
- 統計頁：`daily-stats` 測試 fixture 改為新 shape，並保留一則「舊 shape 文件被拒絕」的負向案例
- 全專案 `npm run test` 與 ingestion 端測試皆通過，型別檢查通過

**範圍邊界**

在範圍內：ingestion 端投影寫入、Web 端投影解析與首頁呈現、前端每日文件契約修正、對應測試、三份 spec 與資料模型文件的同步。

範圍外：昨日比較數字、統計頁的尿量視覺化、既有資料回填、`firestore.rules`、事件層級 spec 的 `pending_calibration` 文件債。

## Risks / Trade-offs

- 同一份數字存在 dailyStats 與 registry 投影兩處，可能漂移 → 投影值一律取自同一 transaction 剛算出的每日紀錄，不獨立累加；整合測試斷言兩者一致
- 讀取端把「投影停在昨天」解讀為今日 0，若使用者裝置時鐘或時區異常，可能顯示錯誤的 0 → 日期一律以固定 `Asia/Taipei` 時區格式化，不受瀏覽端時區設定影響；仍受系統時鐘影響，屬可接受的既有風險（既有時間顯示同樣依賴它）
- 舊 shape 的每日文件在新契約下被拒絕，開發環境若殘留舊資料，統計頁與該日事件寫入都會失敗 → ingestion 端現況已是如此，處置方式是清除開發環境的 dailyStats 子集合後重跑；在資料模型文件中註記
- 遲到事件跨越午夜時，dailyStats 正確歸戶到較早日期，但 registry 投影不會回頭補上那一天的變化 → 這是刻意取捨，投影只服務「今日」視圖，歷史查詢一律走 dailyStats
