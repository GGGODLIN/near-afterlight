# Afterlight — 6-Lens `/review-brainstorm` Shootdown Report

> Date: 2026-11-08
> Target Repository: `/Users/linhancheng/Desktop/projects/near-afterlight`
> Hackathon: NEAR Hackathon 2026 (`https://nearhackathon.com/`, 2nd Independent Entry under `Q-015`)
> Tracks: `["games", "nfts"]` (0 overlap with 1st entry `GhostShift`)

---

## 1. Anchored Hypothesis

1. **Observed pain**:
   - NEAR Hackathon 2026 (`Q-015`) allows up to 2 independent submissions per person, disclosed in both READMEs. Our 1st submission (`GhostShift`) already claimed the 6 AI/security tracks (`security`, `swarms`, `agents`, `business`, `privacy`, `open`).
   - In the `games` and `nfts` tracks, 6+ entries copied the literal pixel market-town merchant prompt (`09-games.md`) and 12+ entries copied the literal wallet-wrapping membership NFT prompt (`10-nfts.md`), while 0 entries model an orbital power-grid & life-support survival economy with degrading equipment NFTs.
   - Standard hackathon blockchain games often render as static B2B tables or trigger wallet popups on every turn, violating `09-games.md`'s criteria ("Judges score the game loop, with a bonus if players never notice the chain" and "A fast-forward mode that simulates a week of trading in a minute").
2. **Anchored hypothesis (refined with background clarifications)**:
   - Build **`Afterlight`**, a turn-based orbital station power-grid and life-support survival economy game on NEAR (`tracks: ["games", "nfts"]`), where 3 station zones (**Solar Array**, **Transmission Corridor** with capacity cap `corridorCapKwh`, and **Habitat & O2 Dome**) exchange power, oxygen, and maintenance across 14 day/eclipse turns (7 orbital days).
   - Equipment units (`gen-solar-1`, `bat-alpha-1`, `bat-beta-2`, `o2-scrubber-1`) are `NEP-171` dynamic NFTs managed alongside an internal integer Station Credit ledger inside a single self-contained NEAR Rust smart contract (`contracts/afterlight/src/lib.rs`, `near-sdk = "=5.29.0"`) and an isomorphic TypeScript engine (`src/engine/`): each NFT carries its own operating/maintenance reserve (`reserveCredits`), charge level (`chargeKwh`), zone placement, and wear (`wearBps`), and transferring an NFT preserves its wear and reserve state without resetting degradation (`P3`).
   - Players control 3 orthogonal actions per turn (`gridPriceTier`, `maintenanceReserveBps`, `batteryZoneRouting`) inside an interactive cross-section station command deck built by an `Opus 5.5 Max` Herdr worker (with background `NEP-366` `SignedDelegate` session authorization so 0 popups interrupt gameplay, 3 one-click 7-day fast-forward presets with animated blackout root-cause autopsy banners, and `npm run verify:judge` verifying `P1` currency conservation, `P2` energy balance conservation, `P3` NFT transfer non-laundering & anti-sybil invariance, and `P4` corridor capacity & budget bounds via `fast-check` `fc.check()` + an independent Oracle).

---

## 2. 6-Lens Reviewer Status

| Seat | Lens | Status | Highest Severity | Key Contributions |
|---|---|---|---|---|
| **Seat 1** | Contrarian / YAGNI & Codebase Reuse | `completed` | `Blocker` | Consolidate `NEP-171` dynamic equipment state + integer Station Credits into a single Rust contract (`near-sdk = "=5.29.0"`), drop separate `NEP-141` contract & external Relayer daemon, and unify per-turn controls to 3 orthogonal knobs (`gridPricePerUnit`, `maintenanceReserveBps`, `batteryZoneRouting`). |
| **Seat 2** | Cost, Quota & Token Economics | `completed` | `Blocker` | Measured `near-sdk` `unit-testing` pulls 448 crates (>120s compile) and `near-sdk = "5.29.0"` caret resolves to `5.30.1` (`compile_error!` without `--cfg clippy`); pin `near-sdk = "=5.29.0"`, keep `verify:judge` under 3s via in-memory TS engine + $O(L \cdot M)$ incremental Oracle, and pre-export trajectory helpers before dispatching `Opus 5.5 Max` workers. |
| **Seat 3** | UX & Developer Ergonomics | `completed` | `Blocker` | Avoid 4 simultaneous continuous sliders; use discrete price/maintenance tiers + 1-click battery zone routing, add a Single Root-Cause Blackout Autopsy Banner (`[Corridor Capped]` vs. `[O2 Scrubber Bankrupt]`), 1-click NFT handover vs. wash-wear exploit buttons, and 0-click ephemeral session key (`NEP-366` hidden under a telemetry drawer). |
| **Seat 4** | Migration, Compatibility & Rollback Safety | `completed` | `Blocker` | Forbid `near-contract-standards` (`#[deprecated]` macros + `assert_one_yocto()` panics for zero-balance gasless players); implement `NEP-171` directly on `#[near(contract_state)]`; stage the `Q-015` cross-disclosure commit on `near-ghost-shift` strictly AFTER `near-afterlight` is public; pre-apply Next 16 Turbopack `import.meta.dirname` fallback & APFS `cp -cR` worktree rule. |
| **Seat 5** | Observability & 3 AM Debuggability | `completed` | `Blocker` | Use `fc.check()` instead of `try { fc.assert() } catch` to emit structured `firstDivergence` step-level Engine-vs-Oracle diffs; enforce turn-scheduled arbitrary with minimum reachability witness floors (`completed14TurnRunsCount >= 50`, `eclipseBatteryDischargeTurnsCount >= 200`, `corridorCapClampedTurnsCount >= 50`, `degradedNftTransferPreservedCount >= 50`); split `NEP-366` envelope vs. execution diagnostics. |
| **Seat 6** | Long-Term Tech Debt & Coupling | `completed` | `Blocker` | Enforce integer basis points (`bps: 0..10_000`) and a fixed 6-step canonical turn resolution pipeline across Rust and TS; share `golden-turn-vectors.json` between Rust pure math tests and TS tests; design `afterlight-oracle.ts` around algebraic state-delta conservation over `TurnAccountingReceipt`; export `simulateOrbitWeek` and `export-film-snapshot.ts` so UI and `onetake` workers never duplicate formulas. |

---

## 3. Existing Reuse Candidates

1. **Zero-SDK-Bloat Isomorphic Project Skeleton (`/Users/linhancheng/Desktop/projects/near-ghost-shift/package.json`)**:
   - Reuse the proven 4-dependency setup (`fast-check`, `next`, `react`, `react-dom`) + `node --experimental-strip-types` runner so `npm test` and `npm run verify:judge` execute in `< 2 seconds` without heavy Web3 bundler overhead, while sharing **zero domain code** (`Q-015`).
2. **Next 16 Turbopack Path Resolution & Worktree Pattern (`/Users/linhancheng/Desktop/projects/near-ghost-shift/src/verifier/judge-audit-runner.ts:65-70`)**:
   - Reuse the `import.meta.dirname ? ... : path.resolve(process.cwd(), ...)` dual-path fallback for reading `contracts/afterlight/src/lib.rs`, `.gitignore` rules for `AGENTS.md` / `/CLAUDE.md` / `.worktrees/`, and `cp -cR` APFS copy-on-write for `node_modules` in Herdr worker worktrees.

---

## 4. Prioritized Objections & Contested Trade-offs

### Blockers & High-Severity Fixes (Converged Across All 6 Seats)

1. **`[Blocker — Seats 1, 2, 4]` Single Self-Contained Rust Contract (`near-sdk = "=5.29.0"`) Without `near-contract-standards` or Separate Relayer Daemon**:
   - `near-contract-standards` macros are `#[deprecated]` in `5.29.0` and force `assert_one_yocto()` on `nft_transfer`, which panics for gasless zero-NEAR players; meanwhile `near-sdk = "5.29.0"` caret resolves to `5.30.1` (`compile_error!` on `aarch64-apple-darwin` without `--cfg clippy`), and `features = ["unit-testing"]` pulls 448 crates (>120s compile).
   - **Resolution**: Pin `near-sdk = "=5.29.0"`, omit `near-contract-standards`, implement `NEP-171` dynamic equipment NFT methods (`nft_token`, `nft_tokens_for_owner`, `nft_transfer`) + internal integer Station Credit ledger directly on `#[near(contract_state)]` in `contracts/afterlight/src/lib.rs`, and keep pure-Rust turn math testable via `RUSTFLAGS="--cfg clippy" cargo test` in `< 8s`.
2. **`[Blocker — Seats 1, 3]` Converge Hybrid Mechanics into 3 Orthogonal Per-Turn Controls + Single Root-Cause Blackout Autopsy**:
   - Combining `Afterlight` (spatial corridor bottleneck) and `Last Light` (generator/scrubber pricing) with 4 continuous sliders causes cognitive overload in a 30-second judge playtest.
   - **Resolution**: Fix the station fleet to 4 equipment NFTs (`gen-solar-1` in Solar Array, `bat-alpha-1` & `bat-beta-2` routable between Solar Array and Habitat Dome across the `corridorCapKwh` Transmission Corridor, and `o2-scrubber-1` in Habitat Dome). Give the player **3 clean controls per turn**:
     1. **Grid Price Tier** (`SUBSIDIZED` / `BALANCED` / `SURGE` integer credits per kWh),
     2. **Maintenance Reserve Retention** (`0% Skim` / `20% Standard` / `40% Fortify`, stored as `0` / `2000` / `4000` `bps`),
     3. **Battery Zone Routing** (`SOLAR_ARRAY` ↔ `HABITAT_DOME` 1-click transfer).
     When a blackout or O2 collapse occurs, display an explicit **Root-Cause Autopsy Banner** (`CORRIDOR_BOTTLENECK_BLACKOUT` vs. `SCRUBBER_SOLVENCY_COLLAPSE` vs. `UNMAINTAINED_CAPACITY_DECAY`) with a 1-click fix hint.
3. **`[Blocker — Seats 2, 5, 6]` `fc.check()` Step-Level Diagnostics, $O(L \cdot M)$ Incremental Oracle & Reachability Witness Floors**:
   - Avoid `try { fc.assert() } catch` and $O(L^2 \cdot M)$ trace re-evaluation.
   - **Resolution**: Use `fc.check()` (`numRuns: 200, seed: 20261108`) with an $O(L \cdot M)$ incremental independent Oracle over integer basis points (`bps: 0..10_000`) and a fixed 6-step canonical turn pipeline (`Solar Generation → Battery Routing & Corridor Clamping → Habitat & O2 Scrubber Consumption → Credit Settlement & Reserve Retention → Maintenance Wear Recovery/Decay → Collapse Verdict`), enforcing minimum reachability witness floors (`completed14TurnRunsCount >= 40`, `eclipseBatteryDischargeTurnsCount >= 150`, `corridorCapClampedTurnsCount >= 40`, `degradedNftTransferPreservedCount >= 40`, `maintenanceStarvationTurnsCount >= 40`).
4. **`[High — Seats 2, 3]` 0-Popup `NEP-366` Ephemeral Session Envelope + 1-Click NFT Handover & Exploit Simulator**:
   - **Resolution**: No wallet-connect blocker on load. An in-memory ephemeral session signs structured `NEP-366` `SignedDelegate` envelopes (`envelopeVerdict` + `executionVerdict` diagnostics, `attachedDeposit === 0`) visible in a collapsible **Judge & On-Chain Telemetry Drawer**, while the main stage stays 100% in station commander language and provides 1-click **`Handover NFT to Operator B`** vs. **`Simulate Wash-Wear / Mid-Payout Exploit`** buttons.
5. **`[High — Seat 4]` Strict Cutover Ordering for `Q-015` Cross-Disclosure on `near-ghost-shift`**:
   - **Resolution**: Do not touch `/Users/linhancheng/Desktop/projects/near-ghost-shift` during `Afterlight` development; only add the `Q-015` cross-link commit to `near-ghost-shift/README.md` and `README.zh-TW.md` after `https://github.com/GGGODLIN/near-afterlight` is public and verified (`17/17` `GhostShift` tests still green).

---

## 5. Key Decisions Needed Before `/to-spec`

All 6 seats converged without unresolved `[contested]` conflicts:
- High-confidence architectural safeguards (single self-contained `near-sdk = "=5.29.0"` contract, integer `bps` math, 3-control game loop with 3 fast-forward presets, $O(L \cdot M)$ `fc.check()` oracle with witness floors, and post-publish `Q-015` README cross-link) can be applied directly into `/to-spec`.
