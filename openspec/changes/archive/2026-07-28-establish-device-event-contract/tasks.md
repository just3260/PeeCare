## 1. 契約驗證基礎

- [x] 1.1 依「以版本化 JSON Schema 作為契約來源」建立 contracts/device-events 獨立 package、AJV 2020 strict-mode 載入器與 npm test 入口；先加入缺少 fixture 必要欄位的失敗案例，再完成 fixture_format 回報，驗證方式為執行 npm test 並確認 malformed fixture 被點名且完整基礎套件以狀態碼 0 結束。
- [x] 1.2 落實 Executable contract fixtures 與「以 fixture manifest 驗證結構與跨欄位規則」，建立正例 envelope、重送 envelope 及具 name／input／expectedError 的反例 manifest 掃描流程；驗證方式為執行 npm test，確認報告載入案例總數，並以暫時破壞一個 expectedError 的測試證明錯誤碼不符會造成非零狀態碼。

## 2. Payload Schema

- [x] 2.1 以測試先行實作 Strict common event envelope 與「固定事件識別與重送語義」的共用 schema，覆蓋 schemaVersion、eventId、deviceId、sequence、recordedAtMs、firmwareVersion、未知欄位及禁止型別轉換；驗證方式為先觀察新增邊界 fixture 失敗，再完成 common-event.v1.schema.json 並執行 npm test 使所有共用欄位案例通過。
- [x] 2.2 [P] 以測試先行實作 Urination event payload 與「使用明確單位與傳輸邊界」的排尿 schema，固定 eventType 並驗證 flushDurationMs／pumpDurationMs 的 uint32 邊界及拒絕 estimatedUrineMl；驗證方式為先加入 3000／5000 正例、字串 duration 與衍生尿量反例，再完成 urination-event.v1.schema.json 並執行 npm test。
- [x] 2.3 [P] 以測試先行實作 Battery event payload 與「使用明確單位與傳輸邊界」的電量 schema，只接受五個電量級距並將 batteryVoltageMv 限為可省略的 0–20000 整數；驗證方式為先加入含／不含電壓正例、30% 與 null 電壓反例，再完成 battery-event.v1.schema.json 並執行 npm test。

## 3. Topic、重送與時間語義

- [x] 3.1 以測試先行實作 Canonical event topics 與「依事件類型分離 Topic 並交叉核對身分」，讓兩個正式 Topic 選到唯一 schema，並以 unsupported_topic、topic_format、device_mismatch 區分失敗；驗證方式為先加入正式 Topic、舊 Topic、非法 segment 與身分不一致案例，再執行 npm test 確認每案回報指定錯誤碼。
- [x] 3.2 以測試先行實作 Stable retry identity，逐欄位比較 original 與 retry 的 Topic 和 Payload，且不以 sequence 當作冪等鍵；驗證方式為先加入完全相同重送、變更 pumpDurationMs 的重送及相同 sequence／不同 eventId 案例，再執行 npm test 確認變更案例回報 retry_mismatch。
- [x] 3.3 以測試先行實作 Mixed event time source 與「以裝置時間候選值產生混合時間來源」，依 1767225600000 下限及 receivedAtMs 加 300000 上限產生 effectiveAtMs／timeSource 並保留原始 recordedAtMs；驗證方式為先加入有效、null、epoch 0 與超過未來容忍一毫秒的案例，再執行 npm test 確認四個具體輸出。

## 4. 使用說明與整體驗收

- [x] 4.1 在 contracts/device-events/README.md 記錄正式 Topic、完整 Payload 範例、eventId 重送規則、recordedAtMs null 規則、錯誤碼與 fixture 使用方式；驗證方式為逐項對照 device-event-contract spec 的七個 Requirement 名稱完成內容審查，並在乾淨安裝相依套件後執行 npm test，確認 AJV 無 unresolved reference 或 unknown keyword 且全部案例通過。
