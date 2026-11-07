# 02 — 7-Day Fast-Forward Trajectory Presets, Film Snapshot Exporter, and 60-Second AI Judge Verification CLI

**What to build:** Implement the parametric 7-day (14-turn) fast-forward simulator `simulateOrbitWeek(initialState, policySchedule)` and 3 canonical trajectory presets in `src/scenarios/station-trajectories.ts` (`01-greedy-surge-collapse`, `02-corridor-bottleneck-blackout`, `03-balanced-survival-walkthrough`), the `onetake` film data exporter `src/scenarios/export-film-snapshot.ts`, and the 60-second AI Judge CLI `src/verifier/judge-audit-runner.ts` + `src/verifier/judge-cli.ts` (`npm run verify:judge`).

**Blocked by:** 01 — Orbital Station Power-Grid & NEP-171 Dynamic Equipment Engine, NEAR Rust Contract, Two-Layer NEP-366 Guard, and Shape 1 Conditional PBT

**Status:** `done`

**Needs:** None — a worker can check every item unaided.

**Validation method:** Run `npm test` and `npm run verify:judge`

**Evidence required:** `tests/judge-verifier.test.ts` passes and `npm run verify:judge` completes in `< 3 seconds` emitting a structured JSON report with `"verdict": "PASS"`, all Rust contract tokens verified, all 5 `fast-check` reachability witness floors satisfied, 4 `NEP-366` relay cases verified, and all 3 7-day trajectories dynamically computed.

**Tests:** `required`

**Test seam:** `src/scenarios/station-trajectories.ts` (`simulateOrbitWeek`, `listTrajectoryPresets`, `runTrajectoryPreset`), `src/scenarios/export-film-snapshot.ts` (`buildFilmSnapshot`), and `src/verifier/judge-audit-runner.ts` (`runJudgeAudit`)

**Regression scope:**
- Preserve all Ticket 01 `P1..P4` engine and Oracle behaviors.
- Verify that `01-greedy-surge-collapse` deterministically triggers `SCRUBBER_SOLVENCY_COLLAPSE`, `02-corridor-bottleneck-blackout` deterministically triggers `CORRIDOR_BOTTLENECK_BLACKOUT`, and `03-balanced-survival-walkthrough` survives all 14 turns with `stationStatus === "SURVIVED"`, while `P1..P4` conservation invariants remain `true` on every turn of both collapse and survival trajectories.

- [x] 2.1 `simulateOrbitWeek` dynamically computes all 14 turn snapshots for `01-greedy-surge-collapse`, `02-corridor-bottleneck-blackout`, and `03-balanced-survival-walkthrough` without hardcoded trajectory outputs, and `evaluateAfterlightOracleStep` confirms `P1..P4` hold on all 14 turns of each preset — Source: Story 3 — Failure: F5
- [x] 2.2 `runJudgeAudit` uses `import.meta.dirname` with a `process.cwd()` fallback to inspect `contracts/afterlight/src/lib.rs` (preventing Next 16 Turbopack `undefined` path crashes) and reports `verdict: "FAIL"` when a required Rust primitive or golden-vector parity check is missing — Source: Story 5 — Failure: F4
- [x] 2.3 `runJudgeAudit` uses `fc.check()` (`numRuns: 200, seed: 20261108`) and emits a structured `firstDivergence` step-level ledger diff (`turnIndex`, `orbitalPhase`, `violatedInvariants`, `ledgerDiff`) when a custom faulty runner is injected, and fails if any of the 5 reachability witness floors (`completed14TurnRunsCount >= 40`, `eclipseBatteryDischargeTurnsCount >= 150`, `corridorCapClampedTurnsCount >= 40`, `degradedNftTransferPreservedCount >= 40`, `maintenanceStarvationTurnsCount >= 40`) is not met — Source: Story 5 — Failure: F2
- [x] 2.4 `npm run verify:judge` completes in under 3 seconds and outputs `"verdict": "PASS"` with `tracks: ["games", "nfts"]` — Source: Story 5, Story 6

## Verification Log

- 2026-11-08 Ticket 02 verified: observed RED (3/3 failing on missing implementation), implemented `station-trajectories.ts`, `export-film-snapshot.ts`, `judge-audit-runner.ts`, and `judge-cli.ts`; `npm test` 10/10 PASS and `npm run verify:judge` PASS in `154ms`.
- 2026-11-08 Ticket 02 YAGNI review (`verdict.json`): applied cuts in commit `e0e884d` (removed premature `buildAutopsyBanner` and `TrajectoryAutopsyBanner`, unexported `AfterlightFilmSnapshot`, `TrajectoryPresetDescriptor`, `FirstDivergenceDiagnostic`, and `JudgeAuditOptions`).


