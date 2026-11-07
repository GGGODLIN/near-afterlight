import assert from "node:assert/strict";
import test from "node:test";
import { applyStationAction } from "../src/engine/afterlight-engine.ts";
import { buildFilmSnapshot } from "../src/scenarios/export-film-snapshot.ts";
import {
  listTrajectoryPresets,
  runTrajectoryPreset,
} from "../src/scenarios/station-trajectories.ts";
import { runJudgeAudit } from "../src/verifier/judge-audit-runner.ts";

test("Ticket 02.1 (Failure F5): simulateOrbitWeek dynamically computes 01-greedy-surge-collapse, 02-corridor-bottleneck-blackout, and 03-balanced-survival-walkthrough", () => {
  const presets = listTrajectoryPresets();
  assert.equal(presets.length, 3);

  const greedy = runTrajectoryPreset("01-greedy-surge-collapse");
  assert.equal(greedy.finalState.stationStatus, "BLACKOUT");
  assert.equal(
    greedy.finalState.collapseRootCause,
    "SCRUBBER_SOLVENCY_COLLAPSE",
  );
  assert.equal(greedy.finalState.turn, 4);

  const corridor = runTrajectoryPreset("02-corridor-bottleneck-blackout");
  assert.equal(corridor.finalState.stationStatus, "BLACKOUT");
  assert.equal(
    corridor.finalState.collapseRootCause,
    "CORRIDOR_BOTTLENECK_BLACKOUT",
  );
  assert.equal(corridor.finalState.turn, 2);

  const balanced = runTrajectoryPreset("03-balanced-survival-walkthrough");
  assert.equal(balanced.finalState.stationStatus, "SURVIVED");
  assert.equal(balanced.finalState.collapseRootCause, null);
  assert.equal(balanced.finalState.turn, 14);
  assert.equal(balanced.turnReceipts.length, 14);

  const film = buildFilmSnapshot();
  assert.deepEqual(film.tracks, ["games", "nfts"]);
  assert.ok(film.presets["03-balanced-survival-walkthrough"]);
});

test("Ticket 02.2 & 02.4 (Failure F4): runJudgeAudit verifies Rust contract, P1..P4 PBT, NEP-366 relay, and 7-day trajectories in under 3 seconds", () => {
  const report = runJudgeAudit();
  assert.equal(report.verdict, "PASS");
  assert.deepEqual(report.tracks, ["games", "nfts"]);
  assert.ok(report.elapsedMs < 3000, `Expected < 3000ms, got ${report.elapsedMs}ms`);
  assert.equal(report.rustContractCheck.passed, true);
  assert.equal(report.rustContractCheck.cargoTomlPinsExact529, true);
  assert.equal(report.rustContractCheck.noDeprecatedStandardsCrate, true);
  assert.equal(report.rustContractCheck.goldenVectorsMatchedCount, 3);
  assert.equal(report.pbtSuite.passed, true);
  assert.equal(report.pbtSuite.witnessFloorsPassed, true);
  assert.deepEqual(report.pbtSuite.invariantsVerified, ["P1", "P2", "P3", "P4"]);
  assert.equal(report.nep366RelaySuite.passed, true);
  assert.equal(report.trajectoryComparison.passed, true);

  // Missing contract file triggers FAIL (Failure F4)
  const badContractReport = runJudgeAudit({
    contractPathOverride: "/nonexistent/contracts/afterlight/src/lib.rs",
  });
  assert.equal(badContractReport.verdict, "FAIL");
  assert.equal(badContractReport.rustContractCheck.passed, false);
});

test("Ticket 02.3 (Failure F2): runJudgeAudit emits firstDivergence diagnostic on faulty runner and fails when witness floors are unmet", () => {
  const faultyReport = runJudgeAudit({
    customActionRunner: (state, action) => {
      const res = applyStationAction(state, action);
      if (action.kind === "AdvanceTurn" && res.accepted) {
        // Inject a P1 currency leak on Turn 1
        res.state.stationTreasuryCredits += 77;
      }
      return res;
    },
  });
  assert.equal(faultyReport.verdict, "FAIL");
  assert.equal(faultyReport.pbtSuite.passed, false);
  assert.ok(faultyReport.pbtSuite.firstDivergence !== null);
  assert.ok(
    faultyReport.pbtSuite.firstDivergence.violatedInvariants.includes("P1"),
  );
  assert.ok(faultyReport.pbtSuite.firstDivergence.ledgerDiff.length > 0);

  // Faulty TransferEquipmentNft step is replayed in counterexample replay and captured in firstDivergence
  const faultyTransferReport = runJudgeAudit({
    customActionRunner: (state, action) => {
      const res = applyStationAction(state, action);
      if (action.kind === "TransferEquipmentNft" && res.accepted) {
        res.state.equipment[action.tokenId].wearBps = 0;
      }
      return res;
    },
  });
  assert.equal(faultyTransferReport.verdict, "FAIL");
  assert.ok(faultyTransferReport.pbtSuite.firstDivergence !== null);
  assert.ok(
    faultyTransferReport.pbtSuite.firstDivergence.violatedInvariants.includes("P3"),
  );

  // Unmet witness floor causes verdict FAIL
  const unmetWitnessReport = runJudgeAudit({
    witnessFloorOverrides: {
      completed14TurnRunsCount: 9999,
    },
  });
  assert.equal(unmetWitnessReport.verdict, "FAIL");
  assert.equal(unmetWitnessReport.pbtSuite.witnessFloorsPassed, false);
});
