## Context

PeeCare Web App 目前透過 Firebase Web SDK 讀取 owner 所屬裝置，Firestore Security Rules 對所有 client write 維持 fail-closed。裝置文件以 `deviceId` 作為不可修改的硬體序號與 document ID；各畫面的裝置選擇器目前直接顯示該序號。現有 Cloud Run ingestion API 使用 EMQX 共用 secret，處理硬體事件並以 Admin SDK 部分更新同一份裝置文件，不具備會員 Firebase ID Token 驗證，也不應承接會員操作。

此變更跨越 Web App、Firebase Authentication、獨立 Member API 與 Firestore device registry。Member API 是新的會員寫入安全邊界；瀏覽器仍不得直接寫入 Firestore。

## Goals / Non-Goals

**Goals:**

- 讓目前 owner 為整台裝置設定或移除一個共用 `customName`。
- 維持 Firestore Web Client 完全唯讀，所有名稱寫入經過獨立 Member API。
- 由 Firebase ID Token 建立會員身分，並以 transaction 重新確認裝置 owner 後才更新。
- 讓首頁、歷史、統計與設定頁共用同一套 display-name resolver 與 reactive device state。
- 提供可容器化、可在 Cloud Run request-based billing 與最低執行個體數 0 運行的 Member API。
- 以單元測試、Firebase Emulator integration tests、Web component/store tests 與 container build 驗證契約。

**Non-Goals:**

- 不讓個別家庭成員為同一台裝置保存不同名稱。
- 不實作裝置分享、解除綁定、owner transfer、claim、通知偏好或裝置刪除。
- 不修改 EMQX ingestion endpoint、webhook secret 或 ingestion service 的部署邊界。
- 不允許 Web Firebase SDK 寫入任何 device、event 或 dailyStats 文件。
- 不要求名稱唯一，不建立名稱查詢或名稱索引。
- 不在此 change 執行 development 或 production Cloud Run 的實際資源建立；此 change 交付可部署 image、runtime contract 與驗證方式，live deployment 由環境部署 change 執行。
- 不加入 App Check、custom domain、load balancer、VPC connector 或常駐 instance。

## Decisions

### 以獨立 Member API Cloud Run 建立會員寫入邊界

新增 `services/member-api` 作為獨立 package、container image 與 Cloud Run service。它不 import 或註冊 ingestion API routes，也不接受 EMQX webhook secret。Cloud Run 網路層允許瀏覽器抵達 endpoint，domain authentication 必須由應用層 Firebase ID Token 完成。

替代方案是在 ingestion service 增加會員 route；雖然少一個 deployment unit，但會把硬體 webhook secret 與會員 Firebase session 放進同一失效範圍，因此不採用。另一個替代方案是開放 Firestore owner 更新 `customName`，但會破壞既有 Web Client 完全唯讀政策，因此不採用。

### 以 Firebase ID Token 與交易內 owner 檢查授權

Web API adapter 每次 mutation 從現有 Firebase Auth instance 取得有效 ID Token，使用 `Authorization: Bearer <token>`，且 request body 不包含 UID。Member API 驗證 token 的簽章、issuer、audience、有效期與撤銷狀態，只使用 decoded `uid`。

Device-name service 在 Firestore transaction 內讀取 `devices/{deviceId}`，要求文件存在且 `ownerUid` 等於 decoded UID，才部分更新 `customName`。owner 在讀寫間改變時 transaction 必須重試並重新授權。不存在與非 owner 都回傳相同 `404 device_not_found`，避免洩漏有效序號。Admin SDK 繞過 Security Rules，因此此檢查不可委派給 Rules。

### 以 optional customName 保存整台裝置的名稱

`devices/{deviceId}.customName` 是 optional string。有效字串先 trim，結果長度必須是 1 至 30 個 Unicode code points，且不得含換行或 Unicode control characters；emoji 與重複名稱允許。傳入 `null` 或只含空白的字串會刪除該欄位，恢復序號 fallback。既有無此欄位的裝置不需 migration。

名稱屬於裝置文件，因此 owner transfer 後預設保留。Ingestion service 使用部分欄位 update，不得重建或覆蓋整份 registry document，故事件寫入會保留 `customName`。

### 以單一 PATCH 契約執行冪等更新

Member API 暴露 `PATCH /v1/devices/:deviceId/display-name`，其中 `deviceId` 必須符合 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`，避免空值、路徑分隔符與未受控 Firestore document path。它只接受 JSON object 且只含 `customName`。成功回傳 `200`：

```json
{
  "deviceId": "PC-000001",
  "customName": "主浴室",
  "displayName": "主浴室"
}
```

移除後 `customName` 為 `null`、`displayName` 為 `deviceId`。相同 payload 重送產生相同文件狀態與成功 response，不需要 idempotency key。

錯誤採穩定 machine code：malformed JSON、額外欄位、無效名稱或無效 device ID 回 `400`；錯誤 Content-Type 回 `415`；缺少、格式錯誤、過期、撤銷或驗證失敗的 token 回 `401 unauthorized`；不存在與非 owner 回 `404 device_not_found`；Firestore 暫時性失敗回 `503 persistence_unavailable`；未分類錯誤回 `500 internal_error`。錯誤 response 包含 request ID，不回傳 token、UID、名稱內容或 Firestore 細節。

### 以限定 origin CORS 與小型 request surface 降低濫用風險

Member API 只對設定的 PeeCare Web origin 回傳 CORS allow-origin，支援該 endpoint 的 `OPTIONS` preflight，並限制 JSON request body 為 8 KiB。CORS 不是授權；非瀏覽器 caller 仍必須通過 Firebase token 與 owner 檢查。Runtime 使用 dedicated service account，權限只涵蓋 Member API 所需的 Firebase token verification 與 Firestore device read/update；不得共用 ingestion webhook secret。

Cloud Run 採 request-based billing、最低執行個體數 0，Member API 與 Firestore 必須位於免跨區資料費或由部署 change 明確核准的相容 location。

### 以單一 displayName resolver 與共用 store 同步 Web UI

Owned-device parser 將 absent `customName` 正規化為 `null`，對存在但不符合 server 規則的值回報 data-integrity error。唯一的 display-name resolver 回傳有效 `customName`，否則回傳 `deviceId`；各 view 與 selector 不自行重複 fallback 邏輯。

Device overview store 提供 async rename operation，透過單一 Member API adapter 送出 request。只有 API 成功 response 才更新共用 devices state；所有使用該 store 的畫面立即反映 canonical response。API 失敗不修改 committed device state。

設定頁同一時間最多一列處於 editing。進入編輯時 focus 並選取目前 display name；其他列的 edit control 暫時 disabled。打勾或 Enter 儲存，取消 control 或 Escape 放棄 draft，點擊列外不自動儲存。儲存中禁止重複送出。client-side validation 失敗不呼叫 API；server/API 失敗保留 draft 與 editing 狀態並顯示非敏感錯誤。成功後退出 editing。設定頁名稱下方永遠顯示 `裝置序號：<deviceId>`；其他畫面只顯示 resolved display name。

### 以可替換 adapter 保持邊界深度

Web 端只有一個 Member API adapter，負責 endpoint、Firebase token、JSON 與 error mapping；store 負責 optimistic policy、committed state 與 view-facing status。Server 端 token verifier、device-name service 與 Firestore repository 各只有一個 adapter：service 隱藏 normalization、授權與 transaction 行為，而不是堆疊單純轉送 wrapper。

刪除 Web adapter 會使 rename operation 無法取得身分或呼叫 API；刪除 server service 會移除 owner 授權與 normalization；刪除 repository 會使 transaction persistence 無法執行，因此每個 seam 都承擔可驗證行為。

## Implementation Contract

**Behavior:**

- 已登入 owner 可在設定頁修改或清除裝置共用名稱；非 owner、匿名或無效 session 無法改名。
- 成功儲存後首頁、歷史、統計、裝置 selector 與設定頁在同一 Web session 立即顯示 canonical display name；重新載入後從 Firestore 取得相同名稱。
- 無 `customName` 的既有裝置繼續顯示 `deviceId`，不需要 backfill。
- Firestore Web SDK 對 device display field 的直接 update 仍被 Rules 拒絕。

**Interface / data shape:**

- HTTP endpoint：`PATCH /v1/devices/:deviceId/display-name`。
- Health endpoint：`GET /healthz` 回傳 `200 {"status":"ok"}`。
- Route `deviceId`：符合 `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`。
- Request authentication：Firebase ID Token Bearer header。
- Request JSON：exactly one `customName` property，其值為 string 或 null。
- Success JSON：`deviceId: string`、`customName: string | null`、`displayName: string`。
- Firestore：optional `devices/{deviceId}.customName`。
- Web model：`OwnedDevice.customName: string | null`；display-name resolver 是所有裝置 label 的唯一來源。
- Runtime：獨立 member-api container、request-based billing、最低執行個體數 0、設定單一 allowed Web origin。

**Failure modes:**

- 任何 authentication、authorization、validation 或 persistence failure 都不修改 Web committed state。
- 401 導向可辨識的 session failure；404 不區分 missing 與 foreign device；503 提供可重試狀態；其他失敗顯示一般儲存失敗。
- Member API log 不包含 Authorization header、raw token、customName 或 request body；所有 response 與 sanitized log 以 request ID 關聯。
- Firestore transaction 內 ownership 不成立時零 write；名稱更新只改變 `customName`，保留 registry、projection 與 ownership 欄位。

**Acceptance criteria:**

- Member API unit tests 驗證 Content-Type、body schema、名稱 boundaries、token outcomes、owner outcomes、stable errors、CORS 與零未授權 write。
- Firebase Emulator integration test 驗證 owner rename、clear、foreign/missing indistinguishable 404、concurrent owner change fail closed、registry fields preserved，以及 Web SDK direct write denied。
- Web unit/component tests驗證 display-name fallback、全部 selector labels、單列 edit state、keyboard controls、saving lock、failure draft retention、success store synchronization 與 serial sublabel。
- Root verification 包含 Web type-check/unit/build、Member API type-check/unit/build、ingestion check 與 Firebase Emulator suite。
- Member API Docker image 可從 `services/member-api/Dockerfile` 建置並以非 root process 啟動 health endpoint。

**Scope boundaries:**

- In scope：Member API source/container、local configuration contract、token verification、Firestore transaction、Web adapter/store/UI、Rules regression test、Emulator integration 與 root verification scripts。
- Out of scope：實際雲端部署 mutation、custom domain、App Check、rate-limiting product、ownership workflow、per-member aliases、ingestion route changes，以及 Firestore Rules client-write例外。

## Risks / Trade-offs

- [Risk] Cloud Run scale-to-zero 造成首次儲存 cold start → 設定頁顯示 saving 狀態並保留 draft；不為低頻操作配置常駐 instance。
- [Risk] Admin SDK 繞過 Rules，錯誤的 server 授權可能形成越權寫入 → transaction 內以 decoded UID 重新確認 owner，並測試 foreign、missing 與 concurrent transfer。
- [Risk] 第二個 service 增加建置、image、設定與監控維護 → 使用獨立 package、root aggregate checks、固定 runtime contract 與 Artifact Registry cleanup。
- [Risk] API 成功但 UI state 未同步 → success response 回傳 canonical model，store 只在成功後以該 response 更新唯一共用 devices state。
- [Risk] 舊文件含非法 `customName` 導致讀取錯誤 → server 是唯一 writer 並強制 validation；runtime parser fail loudly，避免顯示未受控內容。
- [Risk] CORS 被誤認為 authorization → specs 與 tests 明確要求所有 caller 仍通過 token 與 owner 檢查。

## Migration Plan

1. 先加入 optional model/parser 與 fallback resolver，確保無 `customName` 的既有資料保持相容。
2. 建立並驗證 Member API、Firebase token verifier、transaction repository、Emulator integration 與 container image。
3. 接入 Web API adapter、device store rename operation 與設定頁 editing UI，同時保留 Firestore client write denial tests。
4. 由環境部署 change 建立獨立 Cloud Run service、dedicated identity、allowed origin、request-based billing、最低執行個體數 0 與相容 Region，再將 service URL 注入 Web build。
5. 先部署 Member API 並完成 owner/foreign/clear smoke，再部署 Web App；觀察 401、404、503 與 latency。
6. rollback 時先回復前一版 Web App，再將 Member API traffic 切回或移除；已寫入的 optional `customName` 可安全保留，舊版 Web App 會忽略它。

## Open Questions

此 change 內沒有未決產品或介面問題。實際 Cloud Run project、Region、service URL、maximum instances 與 budget threshold 由環境部署 change 依已核准的 development 或 production target 決定，不改變本設計的 runtime contract。
