# Afterlight — review-implement Report

## Run 1
### Input
- target: `/Users/linhancheng/Desktop/projects/near-afterlight` (`main`)
- base_sha: `84ead9647e403f03f4cac4211d9710faac06979b`
- head_sha: `667e401283d68f3057b271fead5cdfa169e2b7a7`
- spec: `/Users/linhancheng/Desktop/projects/near-afterlight/.scratch/afterlight/spec.md`
- tickets:
  - `/Users/linhancheng/Desktop/projects/near-afterlight/.scratch/afterlight/issues/01-station-engine-contract-and-pbt.md`
  - `/Users/linhancheng/Desktop/projects/near-afterlight/.scratch/afterlight/issues/02-fast-forward-trajectories-and-judge-cli.md`
  - `/Users/linhancheng/Desktop/projects/near-afterlight/.scratch/afterlight/issues/03-api-routes-and-opus-station-deck.md`
- raw_session_paths:
  - `/Users/linhancheng/.claude/projects/-Users-linhancheng-Desktop-projects/d3e41a3e-d10a-4193-a28b-0ca37ca8a618.jsonl` (main session `d3e41a3e-d10a-4193-a28b-0ca37ca8a618`)
  - `/Users/linhancheng/.claude/projects/-Users-linhancheng-Desktop-projects-near-afterlight--worktrees-opus-ui/bf312574-936e-4917-a679-d4be75b207a3.jsonl` (delegated Herdr worker `t8z` session `bf312574-936e-4917-a679-d4be75b207a3`, edge: `.scratch/afterlight/dispatch/worker-receipt.json`)
- selected_axes: `scope`, `yagni` (`all`, source: `auto`)
- selected_seats: `opus/scope`, `opus/yagni`
- logical_models: `opus`, `opus`
- resolved_models: `google/gemini-4-argon:high`, `google/gemini-4-argon:high`
- started_at: `2026-11-08T04:56:00+08:00`
- session_count: `2`
- total_raw_bytes: `200488933`
- elapsed_time: `326s`
- token_use: `572576` (`opus/scope`: `281009`, `opus/yagni`: `291567`)
### Axis status
- scope: completed
- yagni: completed
### Events
- `2026-11-08T04:56:00+08:00` — `start`: auto-selected `all` (`scope` + `yagni`) because `ticket_count >= 3` (`3`), work crossed a delegated worker session boundary (`t8z`), and closeout code review produced `>= 3` confirmed core findings (`7`). Prior dispositions in report: `查無前輪` (Run 1). Dispatched `opus/scope` (`a0764c675913574d3`) and `opus/yagni` (`a478e9a99910b54ad`).
- `2026-11-08T05:02:00+08:00` — `seat-return`: `opus/scope` returned `0` Scope findings (`CONFIRMED: 0`, `PLAUSIBLE: 0`); `opus/yagni` returned `7` YAGNI findings (`Y1`..`Y7`).
- `2026-11-08T05:06:14+08:00` — `repair-commit`: applied accepted obligations `R1` (`Y1`), `R2` (`Y4`), `R3` (`Y5`), `R4` (`Y7` CSS custom properties + 11 internal-only `export` keywords) in commit `a542cc3040943a098a96a98a86e22ac6f65f7753`.
- `2026-11-08T05:07:30+08:00` — `targeted-recheck-and-final-suite`: targeted recheck for `R1`..`R4` passed and final suite (`npm test` 14/14, `cargo test` 2/2, `npm run verify:judge` PASS 155ms, `npm run build` EXIT 0, `react-doctor` 0 issues) passed against `a542cc3040943a098a96a98a86e22ac6f65f7753`.
### Findings
- **Scope (`opus/scope`)**: `0` findings (`CONFIRMED: 0`, `PLAUSIBLE: 0`).
- **YAGNI (`opus/yagni`)**:
  - `Y1` (`opus/yagni`): `src/scenarios/station-trajectories.ts:40-41,55-56,69-70,83-84` — write-only `expectedOutcome` and `expectedRootCause` fields on `TrajectoryPresetDescriptor` (0 external reads).
  - `Y2` (`opus/yagni`): `src/engine/afterlight-engine.ts:60,515,626` and `src/engine/afterlight-oracle.ts:121` — `corridorLossKwh` on `TurnAccountingReceipt`.
  - `Y3` (`opus/yagni`): `contracts/afterlight/src/lib.rs:25-35,51,471-478` — `EquipmentHandoverRecord` and `handover_history` on `EquipmentNft`.
  - `Y4` (`opus/yagni`): `src/engine/nep366-session-guard.ts:38-44,47,80-94,165-181` — 8 duplicated envelope fields (`senderId`, `relayerSignerId`, `receiverId`, `nonce`, `lastNonce`, `maxBlockHeight`, `currentBlockHeight`, `executionVerdict.relayerSignerId`) on `Nep366RelayTrace` with 0 external reads.
  - `Y5` (`opus/yagni`): `app/api/simulate/route.ts:76-92,138-145` — duplicated `validTiers`, `validTokenIds`, `validAccountPattern`, and `forbiddenAccountIds` already defined in `src/engine/constants.ts` and `src/engine/afterlight-engine.ts`.
  - `Y6` (`opus/yagni`): `tests/afterlight-engine.test.ts:403-501,673-784` — PBT arbitraries and golden vector check in `tests/afterlight-engine.test.ts` vs `src/verifier/judge-audit-runner.ts`.
  - `Y7` (`opus/yagni`): `app/globals.css:14,17` (`--solar-deep`, `--eclipse` unused CSS vars), 11 unreferenced `export` keywords on internal-only types across `src/` and `app/`, and `PresetCard.clientRun` in `app/deck-session.ts`.
### Main decisions
- `Y1` → **accept (`R1`)**: `expectedOutcome` and `expectedRootCause` on `TrajectoryPresetDescriptor` are never read anywhere in `src/`, `app/`, or `tests/`.
- `Y2` → **dispute**: `spec.md:72` and Ticket 01 `Regression scope` (`01-station-engine-contract-and-pbt.md:23`) explicitly define `P2` with `corridorLossKwh`, and `tests/afterlight-engine.test.ts:547` Role 3 mutates `receipt.corridorLossKwh += 15` to calibrate the Oracle.
- `Y3` → **dispute**: `spec.md:21,49` and `README.md:31` explicitly document `handover_history` on the on-chain `NEP-171` `EquipmentNft` struct in `contracts/afterlight/src/lib.rs`.
- `Y4` → **accept (`R2`)**: none of the 8 duplicated fields on `Nep366RelayTrace` are read by any caller; removing them trims 24 lines while preserving `1.5`, `1.6`, `2.3`, `2.4`, `3.4`.
- `Y5` → **accept (`R3`)**: exporting `isValidAccountId` and `EQUIPMENT_ORDER` from `src/engine/afterlight-engine.ts` and reusing `GRID_PRICE_TIERS` in `app/api/simulate/route.ts` eliminates duplicate validation constants.
- `Y6` → **dispute**: `tests/afterlight-engine.test.ts` is Ticket 01's independent engine/Oracle test suite (`Seam 1`), whereas `src/verifier/judge-audit-runner.ts` is Ticket 02's production CLI runner (`Seam 2`); keeping `Seam 1` tests independent of `Seam 2` preserves test isolation.
- `Y7` → **accept (`R4`, partial)**: removed unused `--solar-deep` and `--eclipse` CSS variables (`app/globals.css:14,17`) and 10 unused `export` keywords on internal types; retained `PresetCard.clientRun` (`choices.md #7`) so `ORBIT_CALENDAR` is derived from engine receipts rather than duplicating odd/even orbital phase math in `app/`.
### Dispositions
- disposition: Y1 | yagni | main=accept | user=n/a | Removed write-only expectedOutcome and expectedRootCause from TrajectoryPresetDescriptor in src/scenarios/station-trajectories.ts
- disposition: Y2 | yagni | main=dispute | user=n/a | Retained corridorLossKwh on TurnAccountingReceipt as required by Ticket 01 P2 contract and Role 3 mutation calibration
- disposition: Y3 | yagni | main=dispute | user=n/a | Retained on-chain EquipmentHandoverRecord and handover_history in contracts/afterlight/src/lib.rs per spec.md:21,49
- disposition: Y4 | yagni | main=accept | user=n/a | Removed 8 unreferenced duplicated envelope fields from Nep366RelayTrace in src/engine/nep366-session-guard.ts
- disposition: Y5 | yagni | main=accept | user=n/a | Reused exported isValidAccountId, EQUIPMENT_ORDER, and GRID_PRICE_TIERS in app/api/simulate/route.ts
- disposition: Y6 | yagni | main=dispute | user=n/a | Retained independent Seam 1 PBT arbitraries in tests/afterlight-engine.test.ts to avoid coupling Ticket 01 unit tests to Ticket 02 verifier module
- disposition: Y7 | yagni | main=accept | user=n/a | Removed unused --solar-deep/--eclipse CSS variables and unexported internal-only types while keeping PresetCard.clientRun for engine-derived ORBIT_CALENDAR
### Repair obligations
- `R1` (`Y1`): delete `expectedOutcome` and `expectedRootCause` from `TrajectoryPresetDescriptor` and `PRESET_DESCRIPTORS` in `src/scenarios/station-trajectories.ts`.
- `R2` (`Y4`): delete unreferenced duplicated envelope fields from `Nep366RelayTrace` in `src/engine/nep366-session-guard.ts`.
- `R3` (`Y5`): export `isValidAccountId` and `EQUIPMENT_ORDER` from `src/engine/afterlight-engine.ts` and reuse them + `GRID_PRICE_TIERS` in `app/api/simulate/route.ts`.
- `R4` (`Y7`): delete unused `--solar-deep` and `--eclipse` from `app/globals.css` and unexport internal-only types across `src/` and `app/`.
### Targeted rechecks
- `R1` (`Y1`): `pass` (`git show a542cc3040943a098a96a98a86e22ac6f65f7753 -- src/scenarios/station-trajectories.ts` confirms removal; `2.1`, `3.1`, `3.2` pass).
- `R2` (`Y4`): `pass` (`git show a542cc3040943a098a96a98a86e22ac6f65f7753 -- src/engine/nep366-session-guard.ts` confirms removal; `1.5`, `1.6`, `2.3` pass).
- `R3` (`Y5`): `pass` (`git show a542cc3040943a098a96a98a86e22ac6f65f7753 -- app/api/simulate/route.ts src/engine/afterlight-engine.ts` confirms shared validation; `1.4`, `3.1` pass).
- `R4` (`Y7`): `pass` (`git show a542cc3040943a098a96a98a86e22ac6f65f7753` confirms removal of `--solar-deep`/`--eclipse` and internal `export` keywords; `next build` and `react-doctor` pass with 0 issues).
### Summary
- Run status: PASS
