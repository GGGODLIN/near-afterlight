import fs from "node:fs";
import path from "node:path";
import fc from "fast-check";
import {
  COORDINATOR_CONTRACT_ID,
  DEFAULT_CORRIDOR_CAP_KWH,
} from "../engine/constants.ts";
import {
  applyStationAction,
  createInitialStationState,
  DEFAULT_OPERATOR_A,
  DEFAULT_OPERATOR_B,
  sumAllStationCredits,
  type StationAction,
  type StationActionOutcome,
  type StationState,
} from "../engine/afterlight-engine.ts";
import { evaluateAfterlightOracleStep } from "../engine/afterlight-oracle.ts";
import {
  buildDeterministicDelegateSignature,
  verifyAndExecuteNep366Delegate,
} from "../engine/nep366-session-guard.ts";
import {
  listTrajectoryPresets,
  runTrajectoryPreset,
} from "../scenarios/station-trajectories.ts";

interface FirstDivergenceDiagnostic {
  seed: number;
  counterexamplePath: string;
  numShrinks: number;
  turnIndex: number;
  orbitalPhase: "DAYLIGHT" | "ECLIPSE";
  violatedInvariants: Array<"P1" | "P2" | "P3" | "P4">;
  failureDetails: string[];
}

export interface JudgeVerificationReport {
  project: "Afterlight";
  tracks: readonly ["games", "nfts"];
  verdict: "PASS" | "FAIL";
  elapsedMs: number;
  rustContractCheck: {
    contractPath: string;
    cargoTomlPinsExact529: boolean;
    noDeprecatedStandardsCrate: boolean;
    requiredTokensFound: string[];
    missingTokens: string[];
    goldenVectorsMatchedCount: number;
    passed: boolean;
  };
  pbtSuite: {
    numRuns: number;
    seed: number;
    invariantsVerified: Array<"P1" | "P2" | "P3" | "P4">;
    witnessCounts: {
      completed14TurnRunsCount: number;
      eclipseBatteryDischargeTurnsCount: number;
      corridorCapClampedTurnsCount: number;
      degradedNftTransferPreservedCount: number;
      maintenanceStarvationTurnsCount: number;
    };
    witnessFloorsPassed: boolean;
    firstDivergence: FirstDivergenceDiagnostic | null;
    passed: boolean;
  };
  nep366RelaySuite: {
    casesVerified: number;
    passed: boolean;
  };
  trajectoryComparison: {
    greedyCollapseTurn: number;
    greedyRootCause: string | null;
    corridorBlackoutTurn: number;
    corridorRootCause: string | null;
    balancedSurvivedTurns: number;
    balancedFinalStatus: string;
    allPresetInvariantsPassed: boolean;
    passed: boolean;
  };
}

interface JudgeAuditOptions {
  contractPathOverride?: string;
  customActionRunner?: (
    state: Readonly<StationState>,
    action: StationAction,
  ) => StationActionOutcome;
  witnessFloorOverrides?: Partial<{
    completed14TurnRunsCount: number;
    eclipseBatteryDischargeTurnsCount: number;
    corridorCapClampedTurnsCount: number;
    degradedNftTransferPreservedCount: number;
    maintenanceStarvationTurnsCount: number;
  }>;
}

const REQUIRED_RUST_TOKENS = [
  "#[near(contract_state)]",
  "pub struct AfterlightContract",
  "pub fn nft_token",
  "pub fn nft_tokens_for_owner",
  "pub fn nft_transfer",
  "pub fn route_battery",
  "pub fn repair_equipment",
  "pub fn advance_turn",
  "pub fn execute_nep366_delegate",
] as const;

export function runJudgeAudit(options?: JudgeAuditOptions): JudgeVerificationReport {
  const startMs = Date.now();
  const baseDir = import.meta.dirname
    ? path.resolve(import.meta.dirname, "../..")
    : process.cwd();

  const contractPath =
    options?.contractPathOverride ??
    path.resolve(baseDir, "contracts/afterlight/src/lib.rs");
  const cargoTomlPath = path.resolve(baseDir, "contracts/afterlight/Cargo.toml");
  const goldenVectorsPath = path.resolve(
    baseDir,
    "src/scenarios/golden-turn-vectors.json",
  );

  // 1. Rust Contract & Golden Vector Parity Check
  const requiredTokensFound: string[] = [];
  const missingTokens: string[] = [];
  let cargoTomlPinsExact529 = false;
  let noDeprecatedStandardsCrate = false;
  let goldenVectorsMatchedCount = 0;

  if (fs.existsSync(cargoTomlPath)) {
    const cargoSrc = fs.readFileSync(cargoTomlPath, "utf8");
    cargoTomlPinsExact529 = cargoSrc.includes('near-sdk = "=5.29.0"');
    noDeprecatedStandardsCrate = !cargoSrc.includes("near-contract-standards");
  }

  if (fs.existsSync(contractPath)) {
    const contractSrc = fs.readFileSync(contractPath, "utf8");
    for (const tok of REQUIRED_RUST_TOKENS) {
      if (contractSrc.includes(tok)) {
        requiredTokensFound.push(tok);
      } else {
        missingTokens.push(tok);
      }
    }
  } else {
    missingTokens.push(...REQUIRED_RUST_TOKENS);
  }

  if (fs.existsSync(goldenVectorsPath)) {
    const vectors = JSON.parse(fs.readFileSync(goldenVectorsPath, "utf8")) as Array<{
      id: string;
      corridorCapKwh: number;
      gridPriceTier: "SUBSIDIZED" | "BALANCED" | "SURGE";
      maintenanceReserveBps: number;
      batAlphaZone: "SOLAR_ARRAY" | "HABITAT_DOME";
      batBetaZone: "SOLAR_ARRAY" | "HABITAT_DOME";
      turnsToRun: number;
      expectedFinalTurn: number;
      expectedStatus: string;
      expectedCollapseRootCause: string | null;
      expectedTotalCredits: number;
      expectedO2Level: number;
      expectedGenSolarWearBps: number;
    }>;

    for (const vec of vectors) {
      let state = createInitialStationState({ corridorCapKwh: vec.corridorCapKwh });
      state = applyStationAction(state, {
        kind: "SetPolicy",
        actorId: DEFAULT_OPERATOR_A,
        gridPriceTier: vec.gridPriceTier,
        maintenanceReserveBps: vec.maintenanceReserveBps,
      }).state;
      state = applyStationAction(state, {
        kind: "RouteBattery",
        actorId: DEFAULT_OPERATOR_A,
        tokenId: "bat-alpha-1",
        targetZone: vec.batAlphaZone,
      }).state;
      state = applyStationAction(state, {
        kind: "RouteBattery",
        actorId: DEFAULT_OPERATOR_B,
        tokenId: "bat-beta-2",
        targetZone: vec.batBetaZone,
      }).state;

      for (let i = 0; i < vec.turnsToRun; i++) {
        const step = applyStationAction(state, {
          kind: "AdvanceTurn",
          actorId: DEFAULT_OPERATOR_A,
        });
        if (!step.accepted) break;
        state = step.state;
      }

      if (
        state.turn === vec.expectedFinalTurn &&
        state.stationStatus === vec.expectedStatus &&
        state.collapseRootCause === vec.expectedCollapseRootCause &&
        sumAllStationCredits(state) === vec.expectedTotalCredits &&
        state.o2Level === vec.expectedO2Level &&
        state.equipment["gen-solar-1"].wearBps === vec.expectedGenSolarWearBps
      ) {
        goldenVectorsMatchedCount += 1;
      }
    }
  }

  const rustContractPassed =
    cargoTomlPinsExact529 &&
    noDeprecatedStandardsCrate &&
    missingTokens.length === 0 &&
    goldenVectorsMatchedCount >= 3;

  // 2. Shape 1 200-run fc.check() Property Suite with Reachability Witness Floors
  const actionRunner = options?.customActionRunner ?? applyStationAction;
  let completed14TurnRunsCount = 0;
  let eclipseBatteryDischargeTurnsCount = 0;
  let corridorCapClampedTurnsCount = 0;
  let degradedNftTransferPreservedCount = 0;
  let maintenanceStarvationTurnsCount = 0;

  const stressTurnStepArb = fc.record({
    gridPriceTier: fc.constantFrom("SUBSIDIZED", "BALANCED", "SURGE") as fc.Arbitrary<
      "SUBSIDIZED" | "BALANCED" | "SURGE"
    >,
    maintenanceReserveBps: fc.constantFrom(0, 2000, 4000),
    routeAlphaTo: fc.constantFrom("SOLAR_ARRAY", "HABITAT_DOME") as fc.Arbitrary<
      "SOLAR_ARRAY" | "HABITAT_DOME"
    >,
    routeBetaTo: fc.constantFrom("SOLAR_ARRAY", "HABITAT_DOME") as fc.Arbitrary<
      "SOLAR_ARRAY" | "HABITAT_DOME"
    >,
    transferTokenId: fc.option(
      fc.constantFrom("gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"),
      { nil: null },
    ),
    useValidOwnerForTransfer: fc.boolean(),
    triggerRepairOn: fc.option(
      fc.constantFrom("gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"),
      { nil: null },
    ),
  });

  const survivalTurnStepArb = fc.record({
    gridPriceTier: fc.constantFrom("SUBSIDIZED", "BALANCED") as fc.Arbitrary<
      "SUBSIDIZED" | "BALANCED" | "SURGE"
    >,
    maintenanceReserveBps: fc.constantFrom(2000, 4000),
    routeAlphaTo: fc.constant("HABITAT_DOME") as fc.Arbitrary<
      "SOLAR_ARRAY" | "HABITAT_DOME"
    >,
    routeBetaTo: fc.constant("SOLAR_ARRAY") as fc.Arbitrary<
      "SOLAR_ARRAY" | "HABITAT_DOME"
    >,
    transferTokenId: fc.option(
      fc.constantFrom("gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"),
      { nil: null },
    ),
    useValidOwnerForTransfer: fc.boolean(),
    triggerRepairOn: fc.option(
      fc.constantFrom("gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"),
      { nil: null },
    ),
  });

  const scheduleArb = fc.oneof(
    fc.array(survivalTurnStepArb, { minLength: 14, maxLength: 14 }),
    fc.array(stressTurnStepArb, { minLength: 14, maxLength: 14 }),
  );

  const prop = fc.property(scheduleArb, (steps) => {
    let state = createInitialStationState({ corridorCapKwh: DEFAULT_CORRIDOR_CAP_KWH });
    const initialTotal = state.initialTotalCredits;

    for (const s of steps) {
      const candidateActions: StationAction[] = [
        {
          kind: "SetPolicy",
          actorId: DEFAULT_OPERATOR_A,
          gridPriceTier: s.gridPriceTier,
          maintenanceReserveBps: s.maintenanceReserveBps,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-alpha-1"]?.ownerId ?? DEFAULT_OPERATOR_A,
          tokenId: "bat-alpha-1",
          targetZone: s.routeAlphaTo,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-beta-2"]?.ownerId ?? DEFAULT_OPERATOR_B,
          tokenId: "bat-beta-2",
          targetZone: s.routeBetaTo,
        },
      ];

      if (s.transferTokenId) {
        const currentOwner =
          state.equipment[s.transferTokenId]?.ownerId ?? DEFAULT_OPERATOR_A;
        const otherActor =
          currentOwner === DEFAULT_OPERATOR_A
            ? DEFAULT_OPERATOR_B
            : DEFAULT_OPERATOR_A;
        candidateActions.push({
          kind: "TransferEquipmentNft",
          actorId: s.useValidOwnerForTransfer ? currentOwner : otherActor,
          tokenId: s.transferTokenId,
          toOwnerId: otherActor,
        });
      }

      if (s.triggerRepairOn) {
        const currentOwner =
          state.equipment[s.triggerRepairOn]?.ownerId ?? DEFAULT_OPERATOR_A;
        candidateActions.push({
          kind: "RepairEquipment",
          actorId: currentOwner,
          tokenId: s.triggerRepairOn,
        });
      }

      candidateActions.push({
        kind: "AdvanceTurn",
        actorId: DEFAULT_OPERATOR_A,
      });

      for (const action of candidateActions) {
        const prevState = state;
        const outcome = actionRunner(prevState, action);
        const verdict = evaluateAfterlightOracleStep(
          prevState,
          action,
          outcome,
          initialTotal,
        );
        if (!verdict.allPassed) {
          return false;
        }
        if (
          action.kind === "TransferEquipmentNft" &&
          outcome.accepted &&
          (prevState.equipment[action.tokenId]?.wearBps ?? 0) > 0
        ) {
          degradedNftTransferPreservedCount += 1;
        }
        if (action.kind === "AdvanceTurn" && outcome.accepted && outcome.receipt) {
          if (
            outcome.receipt.orbitalPhase === "ECLIPSE" &&
            outcome.receipt.batteryDischargedKwh > 0
          ) {
            eclipseBatteryDischargeTurnsCount += 1;
          }
          if (outcome.receipt.corridorClampedKwh > 0) {
            corridorCapClampedTurnsCount += 1;
          }
          if (outcome.receipt.maintenanceReserveBps === 0) {
            maintenanceStarvationTurnsCount += 1;
          }
        }
        state = outcome.state;
      }
    }

    if (state.turn === 14 && state.stationStatus === "SURVIVED") {
      completed14TurnRunsCount += 1;
    }

    return true;
  });

  const details = fc.check(prop, { numRuns: 200, seed: 20261108 });
  let firstDivergence: FirstDivergenceDiagnostic | null = null;

  if (details.failed && details.counterexample) {
    const shrunkSteps = details.counterexample[0];
    let state = createInitialStationState({ corridorCapKwh: DEFAULT_CORRIDOR_CAP_KWH });
    const initialTotal = state.initialTotalCredits;

    outer: for (let idx = 0; idx < shrunkSteps.length; idx++) {
      const s = shrunkSteps[idx];
      const actions: StationAction[] = [
        {
          kind: "SetPolicy",
          actorId: DEFAULT_OPERATOR_A,
          gridPriceTier: s.gridPriceTier,
          maintenanceReserveBps: s.maintenanceReserveBps,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-alpha-1"]?.ownerId ?? DEFAULT_OPERATOR_A,
          tokenId: "bat-alpha-1",
          targetZone: s.routeAlphaTo,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-beta-2"]?.ownerId ?? DEFAULT_OPERATOR_B,
          tokenId: "bat-beta-2",
          targetZone: s.routeBetaTo,
        },
        {
          kind: "AdvanceTurn",
          actorId: DEFAULT_OPERATOR_A,
        },
      ];
      for (const action of actions) {
        const prevState = state;
        const outcome = actionRunner(prevState, action);
        const verdict = evaluateAfterlightOracleStep(
          prevState,
          action,
          outcome,
          initialTotal,
        );
        if (!verdict.allPassed) {
          firstDivergence = {
            seed: details.seed,
            counterexamplePath: details.counterexamplePath ?? "",
            numShrinks: details.numShrinks,
            turnIndex: idx + 1,
            orbitalPhase: (idx + 1) % 2 === 1 ? "DAYLIGHT" : "ECLIPSE",
            violatedInvariants: verdict.violatedInvariants,
            failureDetails: verdict.failureDetails,
          };
          break outer;
        }
        state = outcome.state;
      }
    }
  }

  const floors = {
    completed14TurnRunsCount:
      options?.witnessFloorOverrides?.completed14TurnRunsCount ?? 40,
    eclipseBatteryDischargeTurnsCount:
      options?.witnessFloorOverrides?.eclipseBatteryDischargeTurnsCount ?? 150,
    corridorCapClampedTurnsCount:
      options?.witnessFloorOverrides?.corridorCapClampedTurnsCount ?? 40,
    degradedNftTransferPreservedCount:
      options?.witnessFloorOverrides?.degradedNftTransferPreservedCount ?? 40,
    maintenanceStarvationTurnsCount:
      options?.witnessFloorOverrides?.maintenanceStarvationTurnsCount ?? 40,
  };

  const witnessFloorsPassed =
    completed14TurnRunsCount >= floors.completed14TurnRunsCount &&
    eclipseBatteryDischargeTurnsCount >= floors.eclipseBatteryDischargeTurnsCount &&
    corridorCapClampedTurnsCount >= floors.corridorCapClampedTurnsCount &&
    degradedNftTransferPreservedCount >= floors.degradedNftTransferPreservedCount &&
    maintenanceStarvationTurnsCount >= floors.maintenanceStarvationTurnsCount;

  const pbtPassed = !details.failed && witnessFloorsPassed;

  // 3. NEP-366 Gasless Relay 4-Case Verification
  const relayBaseState = createInitialStationState();
  const relayerId = "relayer.afterlight.testnet";
  const rValid = verifyAndExecuteNep366Delegate(
    {
      senderId: DEFAULT_OPERATOR_A,
      relayerSignerId: relayerId,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 11,
      lastNonce: 10,
      maxBlockHeight: 9000,
      currentBlockHeight: 8900,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        DEFAULT_OPERATOR_A,
        COORDINATOR_CONTRACT_ID,
        "route_battery",
        11,
        9000,
      ),
    },
    {
      kind: "RouteBattery",
      actorId: DEFAULT_OPERATOR_A,
      tokenId: "bat-alpha-1",
      targetZone: "HABITAT_DOME",
    },
    relayBaseState,
  );

  const rExpired = verifyAndExecuteNep366Delegate(
    {
      senderId: DEFAULT_OPERATOR_A,
      relayerSignerId: relayerId,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 11,
      lastNonce: 10,
      maxBlockHeight: 8800,
      currentBlockHeight: 8900,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        DEFAULT_OPERATOR_A,
        COORDINATOR_CONTRACT_ID,
        "route_battery",
        11,
        8800,
      ),
    },
    {
      kind: "RouteBattery",
      actorId: DEFAULT_OPERATOR_A,
      tokenId: "bat-alpha-1",
      targetZone: "HABITAT_DOME",
    },
    relayBaseState,
  );

  const rNonce = verifyAndExecuteNep366Delegate(
    {
      senderId: DEFAULT_OPERATOR_A,
      relayerSignerId: relayerId,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 10,
      lastNonce: 10,
      maxBlockHeight: 9000,
      currentBlockHeight: 8900,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        DEFAULT_OPERATOR_A,
        COORDINATOR_CONTRACT_ID,
        "route_battery",
        10,
        9000,
      ),
    },
    {
      kind: "RouteBattery",
      actorId: DEFAULT_OPERATOR_A,
      tokenId: "bat-alpha-1",
      targetZone: "HABITAT_DOME",
    },
    relayBaseState,
  );

  const rHijack = verifyAndExecuteNep366Delegate(
    {
      senderId: relayerId,
      relayerSignerId: relayerId,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "nft_transfer",
      nonce: 21,
      lastNonce: 20,
      maxBlockHeight: 9000,
      currentBlockHeight: 8900,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        relayerId,
        COORDINATOR_CONTRACT_ID,
        "nft_transfer",
        21,
        9000,
      ),
    },
    {
      kind: "TransferEquipmentNft",
      actorId: DEFAULT_OPERATOR_A,
      tokenId: "bat-alpha-1",
      toOwnerId: relayerId,
    },
    relayBaseState,
  );

  const nep366Passed =
    rValid.envelopeVerdict === "Valid" &&
    rValid.executionVerdict.engineAccepted &&
    rExpired.envelopeVerdict === "ExpiredMaxBlockHeight" &&
    rNonce.envelopeVerdict === "StaleDelegateNonce" &&
    rHijack.envelopeVerdict === "Valid" &&
    rHijack.executionVerdict.engineRejectionCode === "UnauthorizedNftTransfer";

  // 4. 7-Day (14-Turn) Trajectory Presets Comparison
  const greedy = runTrajectoryPreset("01-greedy-surge-collapse");
  const corridor = runTrajectoryPreset("02-corridor-bottleneck-blackout");
  const balanced = runTrajectoryPreset("03-balanced-survival-walkthrough");

  let allPresetInvariantsPassed = true;
  for (const preset of listTrajectoryPresets()) {
    const res = runTrajectoryPreset(preset.id);
    for (let i = 0; i < res.turnSnapshots.length; i++) {
      const prev = i === 0 ? res.initialState : res.turnSnapshots[i - 1];
      const next = res.turnSnapshots[i];
      const receipt = res.turnReceipts[i] ?? null;
      const stepVerdict = evaluateAfterlightOracleStep(
        prev,
        { kind: "AdvanceTurn", actorId: DEFAULT_OPERATOR_A },
        {
          accepted: true,
          rejectionCode: null,
          state: next,
          receipt,
        },
        res.initialState.initialTotalCredits,
      );
      if (!stepVerdict.allPassed) {
        allPresetInvariantsPassed = false;
      }
    }
  }

  const trajectoryPassed =
    greedy.finalState.stationStatus === "BLACKOUT" &&
    greedy.finalState.collapseRootCause === "SCRUBBER_SOLVENCY_COLLAPSE" &&
    corridor.finalState.stationStatus === "BLACKOUT" &&
    corridor.finalState.collapseRootCause === "CORRIDOR_BOTTLENECK_BLACKOUT" &&
    balanced.finalState.stationStatus === "SURVIVED" &&
    balanced.finalState.turn === 14 &&
    allPresetInvariantsPassed;

  const overallPassed =
    rustContractPassed && pbtPassed && nep366Passed && trajectoryPassed;

  return {
    project: "Afterlight",
    tracks: ["games", "nfts"],
    verdict: overallPassed ? "PASS" : "FAIL",
    elapsedMs: Date.now() - startMs,
    rustContractCheck: {
      contractPath,
      cargoTomlPinsExact529,
      noDeprecatedStandardsCrate,
      requiredTokensFound,
      missingTokens,
      goldenVectorsMatchedCount,
      passed: rustContractPassed,
    },
    pbtSuite: {
      numRuns: 200,
      seed: 20261108,
      invariantsVerified: pbtPassed
        ? ["P1", "P2", "P3", "P4"]
        : firstDivergence
          ? (["P1", "P2", "P3", "P4"] as const).filter(
              (inv) => !firstDivergence.violatedInvariants.includes(inv),
            )
          : [],
      witnessCounts: {
        completed14TurnRunsCount,
        eclipseBatteryDischargeTurnsCount,
        corridorCapClampedTurnsCount,
        degradedNftTransferPreservedCount,
        maintenanceStarvationTurnsCount,
      },
      witnessFloorsPassed,
      firstDivergence,
      passed: pbtPassed,
    },
    nep366RelaySuite: {
      casesVerified: 4,
      passed: nep366Passed,
    },
    trajectoryComparison: {
      greedyCollapseTurn: greedy.finalState.turn,
      greedyRootCause: greedy.finalState.collapseRootCause,
      corridorBlackoutTurn: corridor.finalState.turn,
      corridorRootCause: corridor.finalState.collapseRootCause,
      balancedSurvivedTurns: balanced.finalState.turn,
      balancedFinalStatus: balanced.finalState.stationStatus,
      allPresetInvariantsPassed,
      passed: trajectoryPassed,
    },
  };
}
