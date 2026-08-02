## 1. 資料模型與服務骨架

- [x] 1.1 [P] 先在 `src/features/devices/owned-device-model.spec.ts` 與 `src/features/devices/device-display-name.spec.ts` 覆蓋 Shared device custom name、Resolved device display name、absent fallback、1/30/31 Unicode code-point boundaries、control-character rejection 與 malformed Firestore value，再於 `src/features/devices/owned-device-model.ts`、`src/features/devices/device-display-name.ts` 及 fixtures 實作 optional `customName` 與唯一 fallback resolver；以這兩個 Vitest files 通過驗證。
- [x] 1.2 [P] 依「以獨立 Member API Cloud Run 建立會員寫入邊界」與 Independent scale-to-zero runtime，建立 `services/member-api` 的 package、TypeScript/Vitest 設定、Fastify health app、server entry 與不含 ingestion route/secret 的 injected interfaces，先寫 health、404、non-ingestion boundary tests，再以 `npm --prefix services/member-api run check` 驗證獨立 build/test。

## 2. Member API domain 與授權

- [x] 2.1 [P] 依「以 Firebase ID Token 與交易內 owner 檢查授權」完成 Authenticated display-name endpoint 的 token verifier adapter：先測 missing/malformed/expired/revoked/invalid token 全部產生 `401 unauthorized` 且零 repository call，再實作只回傳 decoded `uid`、不接受 body UID 的 Firebase Admin verifier；以 verifier 與 app unit tests 驗證。
- [x] 2.2 [P] 依「以 optional customName 保存整台裝置的名稱」完成 Deterministic custom-name normalization：先以表格測試 null、whitespace、trim、emoji、1/30/31 code points、newline 與 control characters，再實作 canonical string 或 delete-command domain result；以 `services/member-api` domain tests 驗證所有 boundaries。
- [x] 2.3 完成 Transactional owner authorization 與 Registry-preserving update：先以 Firestore Emulator 測 owner success、foreign/missing 相同 `404`、concurrent owner change fail closed、clear、duplicate PATCH、registry/projection/child documents preserved，再實作 transaction repository 與 device-name service，確認所有拒絕路徑零 write 且 ingestion projection update 保留 `customName`。

## 3. HTTP、安全與容器契約

- [x] 3.1 依「以單一 PATCH 契約執行冪等更新」與「以可替換 adapter 保持邊界深度」完成 Canonical success and error responses：先測 exact PATCH body、`deviceId` regex boundaries、Content-Type、8 KiB limit、method handling、200 canonical JSON、400/401/404/413/415/500/503 machine codes 與一致 request ID，再在 `services/member-api/src/app.ts` 組合唯一 verifier、service、repository adapters；以 `services/member-api/test/app.test.ts` 驗證 response schema 與每個 failure 的 call count。
- [x] 3.2 依「以限定 origin CORS 與小型 request surface 降低濫用風險」完成 Browser-origin and log privacy boundary：先測 configured-origin preflight、foreign-origin 無 allow header、allowed origin 仍需 auth，以及 success/failure logs 均不含 token、Authorization、name 或 body，再實作 CORS/config validation 與 sanitized request-ID logging；以安全 unit tests 驗證。
- [x] 3.3 完成 Independent scale-to-zero runtime 的 container contract：建立 non-root multi-stage `services/member-api/Dockerfile` 與 runtime config validation，拒絕缺少 project/origin、production 誤用 Emulator host 與 ingestion secret coupling；以 `services/member-api/test/config.test.ts`、Docker build、`GET /healthz` 回傳 `200 {"status":"ok"}`、non-root process assertion 及 `/v1/emqx/events` 404 驗證 request-based/min-instances-0 deployment handoff 所需資訊完整。

## 4. Web API、store 與互動

- [x] 4.1 建立唯一 `src/features/devices/member-device-api.ts` adapter，先測它從現有 Firebase Auth user 取得 ID Token、只送 `customName`、驗證 canonical success JSON、將 401/404/503/其他錯誤映射為 typed outcomes 且不記錄敏感內容，再實作 endpoint/config injection；以 adapter Vitest suite 驗證。
- [x] 4.2 依「以單一 displayName resolver 與共用 store 同步 Web UI」完成 Canonical shared-name synchronization 與 Save-state reconciliation：先在 store tests 驗證 success 只更新 matching device、排序與 `selectedDeviceId` 不變、clear fallback、failure state 不變及 in-flight duplicate suppression，再加入 async rename operation 與 readonly saving/error state；以 `device-overview-store.spec.ts` 驗證所有 state transitions。
- [x] 4.3 [P] 將 `DeviceSelector.vue` 及首頁、歷史、統計使用的裝置 label 統一接到 Resolved device display name resolver，先更新 component/view tests 驗證 custom name、serial fallback、duplicate labels 仍以 `deviceId` 作為 option value 與改名不觸發 selection，再實作 template wiring；以相關 Vitest files 驗證。
- [x] 4.4 完成 Settings device-name editor：先在 `SettingsView.spec.ts` 測單列 editing、focus/select、其他列 disabled、save/Enter、cancel/Escape、outside no-op、saving lock、client validation 零 API、failure 保留 draft、success exit 與永久 serial sublabel，再實作可存取的 edit/save/cancel controls 與非敏感錯誤文案；以 SettingsView tests 驗證完整鍵盤與點擊流程。
- [x] 4.5 將 Member API URL 與 allowed environment contract 接入 `env.d.ts`、`src/platform/firebase/config.ts`、`src/main.ts`，先測 missing/malformed URL 在初始化前 fail closed、local URL 只允許 local mode、production 要求 HTTPS，再注入單一 API adapter/store dependency；以 platform config tests、Web type-check 與 build 驗證不建立第二個 Firebase app。

## 5. 整合驗證與交付

- [x] 5.1 擴充 `firebase/local/fixtures/members-and-devices.ts` 與 `firebase/local/firestore.rules.spec.ts`，驗證既有/命名裝置 fixtures、owner-only reads，以及 owner 透過 Web SDK 直接更新 `customName` 仍被拒絕；以 Firebase Emulator rules suite 證明 Member API Admin path 沒有放寬 client-write baseline。
- [x] 5.2 將 Member API Emulator integration 納入 `test:firebase`，驗證有效 Firebase member identity 的 rename/clear/reload、foreign/missing 404 等價、concurrent owner change、registry preservation 與 Web reload 後 display-name fallback；以 root `npm run test:firebase` 通過驗證。
- [x] 5.3 更新 root `package.json` aggregate scripts，使 `npm run check` 依序涵蓋 Web type-check/unit/build、Member API type-check/unit/build 與既有 ingestion check，並執行 `npm run check`、`npm run test:firebase` 和 Member API Docker smoke；三項皆成功且沒有 application code 直接寫 Firestore 才完成交付。
