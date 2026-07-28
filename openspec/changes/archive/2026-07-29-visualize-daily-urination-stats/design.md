## Context

DailyStats 已按 Asia/Taipei day key 保存 count 與 pending volume fields。Web 應直接查 aggregate，而非重算 events。

## Goals / Non-Goals

**Goals:** bounded 14-day query、連續日期、count chart、accessible table、selected-device reset。

**Non-Goals:** 不做 volume、跨裝置比較、任意區間、export、預測或圖表套件選型。

## Decisions

### 以 Asia Taipei 產生最近十四日範圍

日期範圍含今天共 14 個 local days，query 只讀該範圍並依 date ascending。

### 缺少 daily document 補為零次

純函式將查詢結果映射成 14 個點；缺日 count 為 0 且標示 synthetic，資料損壞則 error，不把 null volume 當 0。

### 圖表與資料表使用同一 series

視覺 chart 與 semantic table 共用 normalized series，確保鍵盤與 assistive technology 可取得等價資訊。

### 先驗證 daily document 再補 gap

每筆 daily document 必須通過與 ingestion 相同的 read model：document ID/date 一致、timeZone 固定、count 為非負 safe integer、status 為 pending calibration、四個 volume fields 為 null、lastEventAtMs/updatedAtMs 為 finite integers。查詢範圍內不存在的 document 才能合成 zero point；存在但 corrupt 的 document 必須讓整個 series 進入 data-integrity error。store 使用 deviceId 與 generation 隔離 stale response。

## Implementation Contract

**Behavior:** Owner 看到 selected device 最近 14 日排尿次數；缺日連續顯示 0；volume pending 不顯示數值。

**Interface:** repository 回傳 validated daily documents；series builder 回傳 14 個 `{date, urinationCount, synthetic}`；view 暴露 no-device/loading/ready/error。empty 僅代表尚未選取裝置，不把「14 日皆無 document」視為無資料，而是顯示 14 個 synthetic zero points。

**Failure modes:** unauthorized、query failure 或 invalid daily shape 顯示 error，不以部分資料冒充完整趨勢。

**Acceptance criteria:** timezone range、daily shape validation、gap filling、all-zero series、chart/table parity、stale response、device switch 與 error tests 通過。

**Scope boundaries:** in scope 是 14-day count visualization；out of scope 是 volume、custom ranges、export 與 analytics。

## Risks / Trade-offs

- [Risk] 固定 14 日限制探索 → 保持 range builder 可替換，後續 refinement 增加選項。
- [Risk] synthetic zero 與未上線難區分 → series 保留 synthetic flag，UI 提供說明。

## Open Questions

最終圖表形式、可選區間與匯出需求另行決定。
