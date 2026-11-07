# 01 — Orbital Station Power-Grid & NEP-171 Dynamic Equipment Engine, NEAR Rust Contract, Two-Layer NEP-366 Guard, and Shape 1 Conditional PBT

**What to build:** Deliver the standalone `/Users/linhancheng/Desktop/projects/near-afterlight` repository scaffold (`package.json`, `tsconfig.json`, `.gitignore`), single-source domain constants (`src/engine/constants.ts`), self-contained NEAR Rust smart contract (`contracts/afterlight/src/lib.rs`, `near-sdk = "=5.29.0"`), isomorphic 6-step integer basis-point (`bps: 0..10_000`) station turn engine (`src/engine/afterlight-engine.ts`), two-layer `NEP-366` `SignedDelegate` session guard (`src/engine/nep366-session-guard.ts`), shared cross-language golden vectors (`src/scenarios/golden-turn-vectors.json`), and $O(M)$ step-level algebraic conservation Oracle (`src/engine/afterlight-oracle.ts`) verified by a 3-role `fast-check` suite (`tests/afterlight-engine.test.ts`).

**Blocked by:** None — can start immediately

**Status:** `done`

**Needs:** Local Node.js (`v24+` with `--experimental-strip-types`) and Rust `cargo` (`RUSTFLAGS="--cfg clippy" cargo test`) — a worker can check every item unaided.

**Validation method:** Run `npm test` and `RUSTFLAGS="--cfg clippy" cargo test --manifest-path contracts/afterlight/Cargo.toml`

**Evidence required:** Zero test failures across Role 1 concrete capability examples, Role 2 200-run (`seed: 20261108`) `fc.check()` property guardians for `P1..P4` with 5 positive reachability witness counters, Role 3 individual test-local mutations for `P1..P4` plus shrunken counterexample replay, and Rust contract unit tests matching `golden-turn-vectors.json`.

**Tests:** `required`

**Test seam:** `src/engine/afterlight-engine.ts` (`createInitialStationState`, `applyStationAction`), `src/engine/nep366-session-guard.ts` (`verifyNep366DelegateEnvelope`), `src/engine/afterlight-oracle.ts` (`evaluateAfterlightOracleStep`), and `contracts/afterlight/src/lib.rs`

**Regression scope:**
- Conditional PBT (`Shape 1 — Multi-step state machines and conservation invariants`):
  - Applicability domain: 14-turn orbital action sequences (`numRuns: 200`, `seed: 20261108`) over the 4-equipment `NEP-171` fleet (`gen-solar-1`, `bat-alpha-1`, `bat-beta-2`, `o2-scrubber-1`) and 3 station zones (`SOLAR_ARRAY`, `TRANSMISSION_CORRIDOR`, `HABITAT_DOME`).
  - `P1` (Closed-Loop Currency Conservation): `operatorACredits + operatorBCredits + colonistDemandPoolCredits + stationTreasuryCredits + sum(nft.reserveCredits) === initialTotalCredits` (`10_000 CR`) after every step, with exact integer split `retainedToReserve + ownerPayout === grossRevenue`.
  - `P2` (Energy & O2 Balance Conservation): On every `AdvanceTurn`, `solarGeneratedKwh + batteryDischargedKwh === habitatConsumedKwh + scrubberConsumedKwh + batteryChargedKwh + corridorLossKwh + curtailedKwh`, and no battery exceeds its wear-adjusted capacity `Math.trunc((maxCapacityKwh * (10_000 - wearBps)) / 10_000)`.
  - `P3` (`NEP-171` Transfer Non-Laundering & Anti-Sybil Invariance): `TransferEquipmentNft(tokenId, from, to)` updates `ownerId` while preserving `wearBps`, `chargeKwh`, `reserveCredits`, and `zone` (`nextNft.wearBps === prevNft.wearBps && nextNft.reserveCredits === prevNft.reserveCredits && nextNft.chargeKwh === prevNft.chargeKwh`), rejects non-owner/relayer hijack attempts with `UnauthorizedNftTransfer`, and produces identical total energy, wear, and combined operator payout whether the 4 NFTs are held by 1 account or split across 2 accounts.
  - `P4` (Transmission Corridor Capacity Cap & Terminal Blackout Finality): `0 <= receipt.corridorFlowKwh <= state.corridorCapKwh` (`45 kWh`) on every turn, and once `stationStatus === "BLACKOUT"`, `collapseRootCause` is immutable until reset.
  - Independent Oracle boundary: `evaluateAfterlightOracleStep` verifies `P1..P4` algebraically without calling internal engine helpers, and Role 3 calibrates `P1`, `P2`, `P3`, and `P4` via 4 separate test-local mutations.

- [x] 1.1 Rust contract `contracts/afterlight/src/lib.rs` pins `near-sdk = "=5.29.0"` (without `near-contract-standards`), implements `#[near(contract_state)] pub struct AfterlightContract` with `NEP-171` methods (`nft_token`, `nft_tokens_for_owner`, `nft_transfer`), credit queries, and turn resolution, and passes `RUSTFLAGS="--cfg clippy" cargo test` against `src/scenarios/golden-turn-vectors.json` — Source: Story 4, Story 5 — Failure: F5
- [x] 1.2 Isomorphic engine `src/engine/afterlight-engine.ts` executes the canonical 6-step integer basis-point (`bps: 0..10_000`) turn pipeline across Daylight and Eclipse turns, enforcing `corridorCapKwh = 45 kWh` and emitting deterministic `collapseRootCause` (`CORRIDOR_BOTTLENECK_BLACKOUT` | `SCRUBBER_SOLVENCY_COLLAPSE` | `UNMAINTAINED_CAPACITY_DECAY`) — Source: Story 2 — Failure: F6
- [x] 1.3 Once `stationStatus === "BLACKOUT"`, subsequent `AdvanceTurn`, `RouteBattery`, or `SetPolicy` calls are rejected with `TerminalBlackoutImmutable` without mutating balances, NFT state, or `collapseRootCause` — Source: Story 2 — Failure: F1
- [x] 1.4 Engine rejects floating-point numbers, negative basis points, out-of-range `maintenanceReserveBps > 10_000`, unknown `tokenId`, or routing non-battery equipment across zones with `InvalidStationParameters` and zero state mutation — Source: Story 2, Story 4 — Failure: F2
- [x] 1.5 Two-layer `NEP-366` guard (`src/engine/nep366-session-guard.ts`) separates `envelopeVerdict` (`Valid` | `InvalidDelegateSignature` | `StaleDelegateNonce` | `ExpiredMaxBlockHeight` | `WrongReceiverContract` | `NonZeroAttachedDepositForbidden` | `DisallowedDelegateActionKind`) from `executionVerdict` (`effectivePredecessorId === senderId`) and blocks a relayer `signerId` from transferring a player's `NEP-171` NFT — Source: Story 1, Story 4 — Failure: F3
- [x] 1.6 `tests/afterlight-engine.test.ts` passes Role 1 capability tests, Role 2 200-run `fc.check()` property suite for `P1..P4` with all 5 reachability witness floors met, and Role 3 individual test-local mutation calibrations for `P1`, `P2`, `P3`, and `P4` — Source: Story 5

## Verification Log

- 2026-11-08 Batch testing & execution mode approved by user (`"1a, 2a, 3b, 4a, 允許這次派工"`): covering Tickets `01`, `02`, `03` with `testing_mode: tdd`, `execution_mode: Inline (01, 02, 03-API) + Opus 5.5 Max Herdr worker (03-UI)`, `best_of_n: no (3b)`, `state_verification: full PBT (4a)`.
- 2026-11-08 Ticket 01 verified: observed RED (7/7 failing on missing implementation), implemented Rust contract (`near-sdk = "=5.29.0"`), TS engine, NEP-366 guard, and Oracle; `npm test` 7/7 PASS (`232ms`) and `RUSTFLAGS="--cfg clippy" cargo test` 1/1 PASS (`golden_turn_vectors_match_typescript_engine`).
- 2026-11-08 Ticket 01 YAGNI review (`verdict.json`): applied cuts in commit `3b8ae14` (removed `EquipmentHandoverRecord`, `AFTERLIGHT_TRACKS`, `AfterlightTrack`, `StationZone`, `MAINTENANCE_RETENTION_TIERS`, `MaintenanceRetentionTierKey`, `REQUIRED_HABITAT_TOTAL_LOAD_KWH`, and unexported `LedgerFieldDiff`; retained `Cargo.lock` for deterministic `near-sdk = "=5.29.0"` resolution per Seat 2/4 blocker).



