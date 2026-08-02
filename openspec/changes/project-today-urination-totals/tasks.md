## 1. ingestion 端今日投影

- [x] 1.1 依「今日投影的欄位組成」與「遲到事件以日界字串比較決定是否覆寫投影」兩項決策，先寫 services/ingestion-api/test/today-urination-projection.test.ts，涵蓋無現有 todayDate、同日更新、較新日期覆寫、較早日期不覆寫四種情形，斷言輸出的欄位物件內容；此時測試 RED
- [x] 1.2 實作 services/ingestion-api/src/aggregation/today-urination-projection.ts 的純函式，輸入為現有 todayDate 與本次的 DailyUrinationRecord，輸出為要併入 registry 更新的 todayDate、todayUrinationCount、todayEstimatedUrineTotalMl 三欄位（不覆寫時輸出空物件），不接觸 Firestore；以 npm --prefix services/ingestion-api test 轉 GREEN
- [x] 1.3 完成 Registry today totals projection：FirestoreEventSink 在排尿事件的同一 transaction 內把該函式輸出併入 device 文件更新，值取自剛寫入的每日紀錄；擴充 services/ingestion-api/test/firestore-event-sink.integration.test.ts 斷言排尿事件後三欄位與 dailyStats 一致、電量事件不寫入這三欄位、duplicate 結果不改動投影，以 npm run test:firebase 驗證
- [x] 1.4 為 Summed daily urine volume record shape 與 Daily document integrity guard 補齊回歸斷言：在 services/ingestion-api/test/end-to-end-ingestion.integration.test.ts 確認每日文件不含 volumeStatus 與 average/min/max 欄位、estimatedUrineTotalMl 為累加值，且 estimatedUrineTotalMl 為 null 的舊 shape 文件會回 aggregation_integrity_error 並零寫入；此步同時確認 Pending calibration daily record shape 描述的舊行為已不存在

## 2. Web 端今日總覽模型

- [x] 2.1 [P] 依「三欄位完全缺席才是未知，部分缺席是完整性錯誤」決策，先在 src/features/devices/device-overview-model.spec.ts 補上 Validated today totals projection tuple 的案例：完整 tuple、三欄位全缺、部分缺席、todayDate 非 yyyy-MM-dd、次數為負、總量非數字，預期分別為數值、null、以及新的 partial_today_tuple / invalid_today_totals 完整性錯誤；此時測試 RED
- [x] 2.2 在 src/features/devices/device-overview-model.ts 讓 parseDeviceOverview 產出 today 欄位並丟出新的兩個完整性代碼，DeviceOverviewProjection 型別新增 today 為 tuple 或 null；以 npm run test:unit 轉 GREEN
- [x] 2.3 實作 Today totals staleness resolution：依「跨日過期由讀取端判定，並解讀為當日 0」決策，新增以「目前時刻」為參數的解析函式，回傳今日應顯示的次數與總量（tuple 為 null 時未知、todayDate 等於該時刻的 Asia/Taipei 日期時採用投影值、較早日期時為 0 次 0 mL），並以固定注入時刻的測試涵蓋 UTC 16:00 日界前後兩側
- [x] 2.4 依「以 registry 文件的今日投影取代前端額外查詢 dailyStats」決策，讓 HomeOverviewHero 的標題與今日尿量 pill、HomeInstantCards 的今日尿量與今日次數兩張卡改用該解析結果，未知時維持 N/A、兩個 footer 維持 N/A；在 src/views/HomeView.spec.ts 斷言完整投影下顯示實際數字、無 tuple 時顯示 N/A、投影停在前一日時顯示 0

## 3. 統計頁每日文件契約修正

- [x] 3.1 [P] 依「前端每日文件契約向 ingestion 現況對齊」決策，先更新 src/features/stats/daily-stats.spec.ts 的 fixture 為新 shape（無 volumeStatus、estimatedUrineTotalMl 為非負有限數），並保留舊 shape 文件被拒絕的負向案例與 estimatedUrineTotalMl 為負數的案例；此時測試 RED
- [x] 3.2 完成 Validated daily aggregate documents：在 src/features/stats/daily-stats-model.ts 移除 volumeStatus 與 average/min/max 的檢查與型別欄位，改為要求 estimatedUrineTotalMl 是非負有限數，完整性代碼移除 invalid_volume_status 與 invalid_volume_contract、新增 invalid_estimated_urine_total_ml；以 npm run test:unit 轉 GREEN，並確認統計頁在新 shape 文件下呈現 ready 而非錯誤狀態
- [x] 3.3 確認 Pending volume exclusion 移除後統計頁行為不變：DailyUrinationChart 與每日次數表格仍僅顯示次數，不新增尿量欄位，以既有的 src/components/DailyUrinationChart.spec.ts 與 StatsView 測試驗證

## 4. 文件同步與整體驗證

- [x] 4.1 更新 docs/mqtt-interfaces-and-firestore-models.md 的 dailyStats 欄位表為新 shape、補上 devices 文件的三個今日投影欄位與遲到事件不倒退規則，並依「不做既有每日文件的回填」決策在備註說明舊 shape 文件不回填、開發環境需清除 dailyStats 子集合；以人工審閱確認文件與實作一致
- [x] 4.2 執行 npm run check 與 npm run test:firebase 全綠，確認型別檢查、單元測試、建置與 emulator 整合測試皆通過
