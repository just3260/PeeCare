## Context

Web build is public and must contain Firebase public config but no secrets. Hosting must target development only and preserve SPA/PWA behavior.

## Goals / Non-Goals

**Goals:** development target preflight、cloud build、SPA rewrite/cache、release record、member smoke journey。

**Non-Goals:** 不做 production domain、SEO、analytics、App Store 或 visual polish。

## Decisions

### Build 僅接受 approved development config

Preflight 比對 Firebase project/hosting target，拒絕 demo/production、Emulator hosts 與任何 secret-like environment values。

### HTML shell 與 hashed assets 使用不同 cache

SPA rewrite 回 index；index 使用 revalidation，hashed assets 可 immutable cache，service worker update 行為沿用 Web shell contract。

### Release 後執行 member smoke journey

Test member 登入後驗證 device overview、history、stats、direct route reload、sign-out 與 non-owner denial。

### Service worker 不快取 Firebase member data

PWA 僅 precache versioned application shell/assets。任何 Firebase Auth、Firestore streaming/REST、Google identity、Cloud Run API request 均使用 network behavior 且不得進 Cache Storage；sign-out 後 reload/offline 不得顯示前一位會員的 device、history 或 stats。Build inspection 同時確認 bundle 不含 MQTT client import、Broker URL、MQTT credential 或 webhook secret。

## Implementation Contract

**Behavior:** development URL 可載入 Web MVP、完成 member journey，`/sign-in`、`/`、`/history`、`/stats` 深層 route reload 正常，non-owner 資料不可見且 sign-out 後無 cached member data。

**Interface:** deploy dry-run 顯示 target/build hash/files；release summary 記錄 Hosting version 與 smoke result。

**Failure modes:** target/config/secret scan/build/smoke 失敗時不得標記 release healthy。

**Acceptance criteria:** build inspection、cloud adapter target、Hosting preview、cache header/runtime cache exclusions、four-route reload、mobile viewport member journey、sign-out offline check 與 rollback target check 通過。

**Scope boundaries:** in scope 是 development Hosting；out of scope 是 production/custom domain/analytics。

## Risks / Trade-offs

- [Risk] public config 被誤認為 secret → 僅允許 Firebase client config，secret scan 阻擋真正 credential。
- [Risk] cache 保留舊 shell → index revalidate 與 hashed asset separation。

## Open Questions

Development Hosting site ID、release approval與自動部署策略是 apply 前 refinement gates。
