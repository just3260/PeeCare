## 1. Emulator 隔離與啟動

- [x] 1.1 實作 Isolated demo Firebase project 與「固定 demo project 並限制 loopback」，建立 .firebaserc、firebase.json、firestore.indexes.json 與 .env.example，使 CLI、Web config、rules tests 全部固定 demo-peecare 及 127.0.0.1:9099／8085／4000；驗證方式為檢查 Firebase CLI 啟動輸出，並以非 demo project 與 0.0.0.0 設定測試確認操作在建立資源前失敗。
- [x] 1.2 實作 Repeatable Emulator startup，加入 Firebase CLI 相依與 emulators:start script，固定啟動 Auth、Firestore、UI 並載入 rules／indexes；驗證方式為正常啟動三個 services，再佔用 8085 與暫時破壞 rules 各執行一次，確認兩者皆回傳非零狀態且不更換 port。

## 2. Local Web SDK 邊界

- [x] 2.1 以測試先行實作 Fail-closed local Firebase client 的 config parser 與「使用 fail-closed lazy client adapter」，先覆蓋 missing_config、emulator_disabled、project_mismatch、non_loopback_host、production_mode，再完成 LocalFirebaseConfigurationError；驗證方式為每個 invalid case 確認 initializeApp mock 未被呼叫，且 npm run test:unit 通過。
- [x] 2.2 以測試先行完成 getLocalFirebaseServices singleton，依固定順序初始化 app、Auth、Firestore 並連接兩個 Emulators，但不由 src/main.ts 自動呼叫；驗證方式為相同有效 config 呼叫兩次後 app／auth／firestore reference 相同，且無 .env.local、無 Emulator 時 npm run check 仍通過。

## 3. Rules 與重設生命週期

- [x] 3.1 [P] 以測試先行實作 Deny-by-default Firestore rules 與「採 deny-by-default Firestore Rules」，先建立 unauthenticated／authenticated 的 get、create、update、delete 拒絕案例與 rules-disabled fixture setup，再完成 rules_version 2 全路徑拒絕規則；驗證方式為在 Emulator 中執行 firestore.rules.spec.ts，確認八個 client 操作均為 permission-denied 而 setup write 成功。
- [x] 3.2 [P] 以測試先行實作 Deterministic local reset 與「以官方 Emulator API 確定性重設狀態」，先以 fetch mock 覆蓋成功、重複執行、非 demo、非 loopback、Auth 不可達及 Firestore 非 2xx，再完成 reset.mjs；驗證方式為 unit tests 確認危險目標零 DELETE 請求，並在 Emulator 建立一個 account／document 後執行 emulators:reset 確認兩者清空。
- [x] 3.3 驗證 reset 的真實失敗輸出：分別停止 Auth 與 Firestore Emulator 後執行 emulators:reset；完成條件為兩次均以非零狀態結束、點名失敗 endpoint，恢復 services 後連續執行兩次 reset 均成功。

## 4. 品質命令與交接

- [x] 4.1 實作 Emulator quality gates 與「分離快速與 Emulator 品質閘門」，加入 test:firebase 以 emulators:exec 啟停 Auth／Firestore 並執行 client／rules tests，加入 check:all 串接既有 check；驗證方式為無常駐 Emulator 時 npm run check、npm run test:firebase、npm run check:all 依序通過，且 test:firebase 結束後 ports 9099／8085 不再接受連線。
- [x] 4.2 [P] 完成 Documented local workflow，在 firebase/local/README.md 記錄 Node／Java 先決條件、demo project、固定 endpoints、.env.local 建立、startup、reset、test 與 check:all，並明確禁止把未加密 Emulator ports 暴露到 loopback 之外；驗證方式為從乾淨 checkout 按文件操作，不執行 firebase use 或建立 cloud project即可完成 check:all。
- [x] 4.3 依 local-firebase-platform spec 執行最終範圍審查與 npm run check:all；完成條件為所有自動測試通過，package／文件不含 real project ID、service account 或 secrets，且未新增 Auth UI、domain collections、Hosting、Cloud Run、Storage、Realtime Database 或 production adapter。
