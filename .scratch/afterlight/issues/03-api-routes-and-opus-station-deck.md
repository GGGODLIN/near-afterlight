# 03 — Simulation & Verification API Routes, Interactive Orbital Station Cross-Section Command Deck (Opus 5.5 Max Worker), and Judge READMEs

**What to build:** Implement `POST /api/simulate` (`app/api/simulate/route.ts`) and `GET /api/verify` (`app/api/verify/route.ts`), delegate the Next.js interactive orbital station cross-section tactical game UI (`app/page.tsx`, `app/command-deck.tsx`, `app/globals.css`) to an `Opus 5.5 Max` (`--model 'opus[1m]' --effort max`) Herdr worker via `agent-dispatch`, and author bilingual judge documentation (`README.md`, `README.zh-TW.md`) with `"Do X, See Y"` steps and `Q-015` cross-disclosure.

**Blocked by:** 02 — 7-Day Fast-Forward Trajectory Presets, Film Snapshot Exporter, and 60-Second AI Judge Verification CLI

**Status:** `ready-for-agent`

**Needs:** Local Next.js dev/build server and Herdr terminal identity (`HC_TERMINAL_ID` / `HERDR_PANE_ID`) for dispatching the `Opus 5.5 Max` frontend worker.

**Validation method:** Run `npm test`, `npm run build`, `npm run verify:judge`, and verify the live rendered game UI in Chrome via LCU screenshots.

**Evidence required:** `tests/api-routes.test.ts` passes, `next build` succeeds with zero errors, and LCU screenshots confirm the 3-zone orbital cross-section SVG/Canvas, day/eclipse visual lighting, Single Root-Cause Blackout Autopsy Banner, 1-click `NEP-171` handover & wash-wear exploit buttons, and collapsible Judge & On-Chain Inspector drawer.

**Tests:** `required`

**Test seam:** `app/api/simulate/route.ts` (`POST`), `app/api/verify/route.ts` (`GET`), and `README.md` / `README.zh-TW.md`

**Regression scope:**
- Preserve all Ticket 01 and Ticket 02 engine, Oracle, and CLI behaviors.
- Verify `POST /api/simulate` handles preset IDs, custom 14-turn policy schedules, and single-step turn/NFT handover actions, while returning HTTP 400 on malformed JSON or invalid preset IDs.

- [ ] 3.1 `POST /api/simulate` returns HTTP 200 with full 14-turn `TurnAccountingReceipt[]`, `nftFleetState`, and `collapseAutopsy` for all 3 preset IDs and custom policy schedules, and returns HTTP 400 (`InvalidSimulationRequest`) on malformed JSON, unknown `presetId`, or invalid action payloads — Source: Story 2, Story 3 — Failure: F2
- [ ] 3.2 Switching from a `BLACKOUT` trajectory preset (`01-greedy-surge-collapse` or `02-corridor-bottleneck-blackout`) to `03-balanced-survival-walkthrough` clears `collapseRootCause` (`null`) and restores `stationStatus === "SURVIVED"` without stale blackout error state — Source: Story 2, Story 3 — Failure: F1
- [ ] 3.3 `GET /api/verify` returns HTTP 200 with `JudgeVerificationReport` (`verdict: "PASS"`, `tracks: ["games", "nfts"]`, all 4 invariants `P1..P4` and 5 reachability witness floors passed) — Source: Story 5
- [ ] 3.4 `Opus 5.5 Max` Herdr worker delivers the interactive orbital station cross-section command deck (`app/command-deck.tsx`, `app/globals.css`, `app/page.tsx`) with 3-zone spatial SVG/Canvas, Day/Eclipse lighting, Web Audio synthesized tactical sound effects, 3 discrete turn controls, 1-click 7-day fast-forward playback, Single Root-Cause Blackout Autopsy Banner, `NEP-171` equipment rack (`Handover NFT to Operator B` + `Simulate Exploit: Wash Wear`), and collapsible Judge Inspector drawer — Source: Story 1, Story 2, Story 3, Story 4
- [ ] 3.5 `README.md` and `README.zh-TW.md` document the problem, 4 NEAR primitives (`NEP-171` dynamic equipment NFTs, `NEP-141` station credits, `NEP-366` gasless session envelopes, `near-sdk v5.29.0` Rust contract), `"Do X, See Y"` judge steps (`npm run verify:judge`), `tracks: ["games", "nfts"]`, and the `Q-015` independent project disclosure naming `GhostShift` — Source: Story 5, Story 6 — Failure: F5

## Verification Log
