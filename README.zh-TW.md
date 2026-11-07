# Afterlight — NEAR 鏈上太空站長夜電網與 NEP-171 動態設備 NFT 生存策略遊戲

[English](/README.md) | [繁體中文](/README.zh-TW.md)

為 **NEAR Hackathon 2026**（`https://nearhackathon.com/`）打造。

- **參賽賽道（Tracks）**：`games`（Games With Real Economies）、`nfts`（NFTs That Do Something）
- **公開 GitHub 儲存庫**：`https://github.com/GGGODLIN/near-afterlight`

> **雙案獨立揭露聲明（規則 `Q-015`）**：依 NEAR Hackathon 官方規則 `Q-015`（*"Allowed if projects are independent and disclosed: each README names the other project"*），本參賽者提交之兩個專案在賽道、問題空間與程式碼上 100% 獨立且零重疊：
> 1. **[GhostShift](https://github.com/GGGODLIN/near-ghost-shift)** — 單調代次柵欄（Monotonic Epoch Fencing）與 `Yield & Resume` 任務交接審計台（賽道：`security`, `swarms`, `agents`, `business`, `open`, `privacy`）。
> 2. **Afterlight**（本儲存庫）— 太空站長夜電網調度與 `NEP-171` 動態磨損設備 NFT 策略生存遊戲（賽道：`games`, `nfts`）。

---

## 解決什麼問題：「發電區明明有電，為什麼居住艙還在日蝕長夜停電？」

在 14 個半軌道回合（7 個軌道日的白晝 `DAYLIGHT` 與日蝕 `ECLIPSE` 交替）中，太空站由三個區域構成：

1. **日照發電翼（`SOLAR_ARRAY`）**：部署 `gen-solar-1`（`Helios-IX` 太陽能帆板 NFT），白晝滿載發電 `100 kWh`，日蝕期間發電 `0 kWh`。
2. **高壓輸電走廊（`TRANSMISSION_CORRIDOR`）**：每回合最大輸電上限為 `corridorCapKwh = 45 kWh`。
3. **居住與製氧穹頂（`HABITAT_DOME`）**：部署 `o2-scrubber-1`（`Aegis-IV` 製氧機 NFT），白晝需電 `35 kWh`（居住 `20 kWh` + 製氧 `15 kWh`），日蝕長夜因保溫加熱器啟動需電 **`50 kWh`**。

因為日蝕長夜的總需求（`50 kWh`）大於輸電走廊上限（`45 kWh`），**就算兩顆 `CryoCell` 儲能電池 NFT（`bat-alpha-1` 與 `bat-beta-2`）在發電翼充滿電，一旦忘記在日蝕前把電池移防到居住穹頂就地放電，電力就會卡死在 `45 kWh` 走廊上限而引發斷電（`CORRIDOR_BOTTLENECK_BLACKOUT`）**；同理，若貪婪拉高暴利電價（`8 CR/kWh`）會害製氧機在第 4 回合破產斷氧（`SCRUBBER_SOLVENCY_COLLAPSE`），若提撥 `0 bps` 維修金則會因設備磨損爆表而崩潰（`UNMAINTAINED_CAPACITY_DECAY`）。

---

## 評審 60 秒可重現驗證步驟（"Do X, See Y"）

### 步驟 1：執行 60 秒 AI 評審一鍵驗收套件（`Q-017`）
- **Do X**：
  ```bash
  npm install
  npm run verify:judge
  ```
- **See Y**：
  - 約 `0.16 秒` 內完成並印出 `"verdict": "PASS"` 與 `"tracks": ["games", "nfts"]` 的 JSON 報告。
  - 驗證 `contracts/afterlight/src/lib.rs`（`near-sdk = "=5.29.0"`）的 `NEP-171` 動態設備原語與 3 組跨語言 Golden Vectors。
  - 透過 `fast-check`（`fc.check()`）執行 200 次隨機 14 回合序列驗證 `P1`（封閉貨幣守恆）、`P2`（能量收支守恆）、`P3`（`NEP-171` 轉手不洗白磨損與準備金＋防女巫拆分不變性）、`P4`（輸電走廊容量上限與斷電終態不可逆），並通過全部 5 項可達性見證門檻。
  - 驗證 `NEP-366` 雙層免彈窗簽章守衛與 3 組 7 日快轉軌跡對照。

### 步驟 2：執行完整單元測試與 Rust 合約黃金向量測試
- **Do X**：
  ```bash
  npm test
  RUSTFLAGS="--cfg clippy" cargo test --manifest-path contracts/afterlight/Cargo.toml
  ```
- **See Y**：
  - 14 項 TypeScript 測試與 Rust 合約單元測試全數通過（0 失敗）。
