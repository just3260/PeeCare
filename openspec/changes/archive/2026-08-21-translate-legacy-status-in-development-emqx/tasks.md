## 1. 前置條件與測試骨架

- [x] 1.1 確認 `align-emqx-webhook-with-serverless` 已完成並 archive，且目前 `deploy/development/emqx-webhook.template.json`、設定工具與 verifier 已反映 Serverless body credential wrapper及canonical delivery基線；若前置條件未滿足則以明確precondition停止，不覆寫active work，並以 `spectra list --json`、`spectra list --parked --json`與artifact content review驗證。
- [x] 1.2 [P] 先在 `deploy/development/configure-emqx-webhook.spec.ts` 加入會失敗的測試，鎖定「使用獨立 opt-in compatibility rule 與 action」、「以 publisher allowlist 與 payload boundary 限制 legacy 輸入」、Opt-in isolated compatibility route、Approved publisher and legacy payload eligibility、Exact development topic filter及Canonical urination transformation的正例與所有邊界負例；以 `npx vitest run deploy/development/configure-emqx-webhook.spec.ts` 確認測試在實作前因缺少compatibility行為失敗。
- [x] 1.3 [P] 先在 `deploy/development/verify-emqx-webhook.spec.ts` 加入會失敗的mode-aware測試，鎖定Sanitized configuration and mode-aware verification與Webhook delivery verification的disabled legacy non-delivery、enabled external delivery、registry mismatch、timeout、multiple matches、field mismatch及redaction；以 `npx vitest run deploy/development/verify-emqx-webhook.spec.ts` 確認測試在實作前失敗。

## 2. Compatibility rule、action 與 checklist

- [x] 2.1 在 `deploy/development/emqx-webhook.template.json` 實作「使用獨立 opt-in compatibility rule 與 action」與Opt-in isolated compatibility route：新增預設disabled、精確匹配 `peecare/device/1/status`、共享既有HTTPS connector但使用獨立action的template區段，保持canonical rule恰有兩個既有filters；以template snapshot assertions及 `npx vitest run deploy/development/configure-emqx-webhook.spec.ts` 驗證enable／disable不改canonical設定。
- [x] 2.2 在compatibility SQL與action body完成「以 publisher allowlist 與 payload boundary 限制 legacy 輸入」及「將合格 delivery 建構為固定目標的 canonical urination envelope」：filter核准clientId／username、non-retained、online與uint32-safe pump seconds，輸出固定target、UUID eventId、sequence 1、broker時間、flush 0與rounded pump milliseconds，且丟棄未核准欄位；以SQL／body contract測試驗證10.4秒得到10400毫秒、eventId pattern、exact keys及所有負例零action result。
- [x] 2.3 在 `deploy/development/configure-emqx-webhook.mjs` 完成「接受 per-delivery identity 與累計 duration 的 test-only 語義」及「使用 mode-aware checklist 與驗證避免 canonical 契約漂移」的設定面：預設canonical-only、enabled時要求安全bounded source identity inputs並驗證完整template、輸出daily stats污染與retry限制警告、維持零EMQX mutation與secret redaction；以configure unit tests及 `npm run emqx:development:checklist` 的sanitized output assertion驗證。

## 3. Mode-aware 端到端驗證

- [x] 3.1 在 `deploy/development/verify-emqx-webhook.mjs` 實作disabled與enabled互斥模式：disabled保留legacy non-delivery，enabled略過矛盾的non-delivery assertion並要求externally triggered compatibility evidence，同時維持canonical urination／battery probe、hidden-TTY device credential與rule-drift rehearsal；以Webhook delivery verification表格測試證明同一run不會同時報告legacy absence與delivery成功。
- [x] 3.2 為enabled mode實作Sanitized configuration and mode-aware verification的Firestore bounded polling：從開始時間後只接受恰一筆固定target、`compat:` prefix event，驗證registry、fixed fields、expected rounded duration、timestamp equality、transport username與qos，並為precondition、timeout、multiple matches、field mismatch與read failure回不同typed outcome；以注入adapter的unit tests與redaction assertions驗證summary不含eventId、payload、webhook secret或MQTT password。

## 4. Lifecycle、文件與完整驗證

- [x] 4.1 [P] 更新 `deploy/development/EMQX_RUNBOOK.md` 與 `docs/mqtt-server-integration.md`，落實「以停用 rule 作為立即回滾邊界」、Explicit test-only event semantics及Reversible development-only lifecycle：文件列出enable前提、Dashboard SQL Test正反例、Arduino external trigger、daily stats污染、retry不穩定、停用／移除順序及不自動清理Firestore資料；以文件content review與secret／production-enablement source scan驗證。
- [x] 4.2 更新 `package.json` 的development EMQX commands或參數說明，使operator可明確選擇canonical-only與compatibility verification；依Serverless live evidence讓decoded payload alias先於dependent expression建立，並以`CASE`保護duration arithmetic，使缺值與非數字delivery產生零result而非`select_and_transform_error`。執行 `npx vitest run deploy/development/configure-emqx-webhook.spec.ts deploy/development/verify-emqx-webhook.spec.ts`、既有device event contract與ingestion checks、`npm run check`，同時維持 `ESP32-derived physical device identifier` 與「依使用邊界區分實體與合成裝置 identity」回歸契約；Dashboard SQL Test驗證正例及offline、publisher mismatch、缺值、字串、負值、overflow負例，實際MQTT delivery驗證retained負例；最後以approved Arduino live rehearsal驗證正例恰寫入一筆、canonical topics仍可交付且停用compatibility後立即停止legacy delivery。

## 5. ESP32 實體 identity 對齊

- [x] 5.1 更新實體 development device inventory schema、runtime validation、fixture與firmware configuration example，使 deviceId 僅接受保留前導零、無分隔符的 `^[0-9A-F]{12}- ，mqttPrincipal 與 Firestore documentPath 由同一值導出；以 `68E274BD2A58` 正例及小寫、錯誤長度、冒號、連字號、缺少前導零負例驗證。通用device event contract與`developmentTestTool` marker邊界維持不變。
- [x] 5.2 將compatibility template、configuration validation、verifier與focused tests的固定target由舊合成ID改為 `68E274BD2A58`，涵蓋canonical topic、clientId、payload deviceId、eventId prefix與`devices/68E274BD2A58` registry precondition；不得以ID regex取代approved source clientId／username與registry／credential binding。
- [x] 5.3 更新runbook與MQTT integration文件中的實機範例及污染警告，執行device configuration、compatibility、ingestion與Test Tool regression checks，證明實體ID被接受、`PC-DEV-######`合成測試裝置仍由marker流程運作，且兩者不互相誤判。

## 6. Paired compatibility 測試骨架

- [x] 6.1 [P] 在 `deploy/development/configure-emqx-webhook.spec.ts` 先加入會失敗的測試，鎖定「使用成對的 legacy Battery 與 Urination rules/actions」、Opt-in paired compatibility routes、Urination legacy payload eligibility、Battery legacy payload eligibility、Canonical urination transformation、Canonical battery transformation與Exact development topic filter：同一shared connector恰有兩條exact legacy rules與兩個event-specific actions，Battery以0–20V boundary、`round(batteryV * 1000)`、7.0／7.5／8.0／8.5V tier、固定`Peecare`username及`compatbattery:` UUID prefix輸出；以`npx vitest run deploy/development/configure-emqx-webhook.spec.ts`確認現有single-route template因缺少Battery pair而失敗。
- [x] 6.2 [P] 在 `deploy/development/verify-emqx-webhook.spec.ts` 先加入會失敗的測試，鎖定「使用 paired mode-aware verification 驗證雙事件」、Explicit paired test-only event semantics、Sanitized paired configuration and verification與Webhook delivery verification：單一external legacy status必須找到恰一筆`compat:`Urination及恰一筆`compatbattery:`Battery event，涵蓋任一類型timeout、partial evidence、multiple matches、field mismatch、registry mismatch與redaction；以focused vitest確認現有single-event verifier失敗。

## 7. Paired rules、actions 與 verifier 實作

- [x] 7.1 在 `deploy/development/emqx-webhook.template.json` 與 `deploy/development/configure-emqx-webhook.mjs` 實作「將 batteryV 轉成 canonical battery envelope」及paired topology validation：保留Urination contract，新增Battery SQL/action exact contract，讓enable-ready checklist只在一connector、兩rules、兩actions完整且各rule恰綁一action時通過，並維持零EMQX mutation與credential redaction；以6.1測試、sanitized checklist snapshot及template content assertion驗證。
- [x] 7.2 在 `deploy/development/verify-emqx-webhook.mjs` 實作paired bounded polling與typed outcomes，新增expected battery volts input，按event type分組比對兩個prefix、canonical topics、rounded voltage、battery tier、fixed usernames、timestamps與qos，且不依賴結果順序；以6.2測試證明恰兩筆才通過、單一route可獨立zero result但paired rehearsal缺任一event即失敗。

## 8. Lifecycle、文件與完整回歸

- [x] 8.1 [P] 更新 `deploy/development/EMQX_RUNBOOK.md`、`docs/mqtt-server-integration.md`與`package.json` operator guidance，落實「以停用兩條 rules 作為回滾邊界」與Reversible paired development-only lifecycle：文件化實際一connector／兩enabled rules／兩Available actions拓撲、Battery SQL正反例、兩種event污染、partial disable degraded state及兩rule/two action移除順序；以content review、secret scan與production enablement scan驗證。
- [x] 8.2 執行focused compatibility tests、device event contract與ingestion battery checks、`npm run check`及`npm run emqx:development:checklist` sanitized review；再以approved Arduino單一status驗證Firestore恰一筆Urination與恰一筆Battery event，對照已人工驗收的一connector／兩rules／兩actions拓撲，並確認停用兩條rules後兩種prefix皆停止新增，作為paired change的最終live acceptance evidence。

## 9. 驗收語義降級

- [x] 9.1 依2026-08-21 operator決策，將8.2的程式化provenance宣稱降級為人工佐證的`paired_shape_observed`：verifier只證明兩個event shape、cardinality、共同broker timestamp與declared values相符，summary明示`human_attestation_required`，不宣稱approved Arduino來源已由Firestore證明；以focused verifier tests、artifact consistency review及`npm run check`驗證。
