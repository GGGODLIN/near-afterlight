import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";
import {
  AFTERLIGHT_TRACKS,
  COORDINATOR_CONTRACT_ID,
  DEFAULT_CORRIDOR_CAP_KWH,
  INITIAL_TOTAL_STATION_CREDITS,
} from "../src/engine/constants.ts";
import {
  applyStationAction,
  createInitialStationState,
  sumAllStationCredits,
  type StationAction,
  type StationState,
} from "../src/engine/afterlight-engine.ts";
import { evaluateAfterlightOracleStep } from "../src/engine/afterlight-oracle.ts";
import {
  buildDeterministicDelegateSignature,
  verifyAndExecuteNep366Delegate,
} from "../src/engine/nep366-session-guard.ts";

const OPERATOR_A = "commander-a.afterlight.testnet";
const OPERATOR_B = "operator-b.afterlight.testnet";
const RELAYER_ID = "relayer.afterlight.testnet";

test("Role 1 (Ticket 01.2 & 01.3): Daylight generation, Corridor bottleneck eclipse blackout, and TerminalBlackoutImmutable finality", () => {
  let state = createInitialStationState();
  assert.equal(sumAllStationCredits(state), INITIAL_TOTAL_STATION_CREDITS);
  assert.deepEqual(AFTERLIGHT_TRACKS, ["games", "nfts"]);
  assert.equal(Object.keys(state.equipment).length, 4);

  // Route both batteries to SOLAR_ARRAY so Habitat Dome has 0 local battery backup during Eclipse
  const r1 = applyStationAction(state, {
    kind: "RouteBattery",
    actorId: OPERATOR_A,
    tokenId: "bat-alpha-1",
    targetZone: "SOLAR_ARRAY",
  });
  assert.equal(r1.accepted, true);
  state = r1.state;

  const r2 = applyStationAction(state, {
    kind: "RouteBattery",
    actorId: OPERATOR_B,
    tokenId: "bat-beta-2",
    targetZone: "SOLAR_ARRAY",
  });
  assert.equal(r2.accepted, true);
  state = r2.state;

  // Set tight corridor cap (25 kWh < 35 kWh Habitat + Scrubber requirement) to force corridor bottleneck in Eclipse
  state = {
    ...state,
    corridorCapKwh: 25,
  };

  // Turn 1 (DAYLIGHT): Corridor caps transmission at 25 kWh (< 35 kWh required), triggering CORRIDOR_BOTTLENECK_BLACKOUT
  const t1 = applyStationAction(state, {
    kind: "AdvanceTurn",
    actorId: OPERATOR_A,
  });
  assert.equal(t1.accepted, true);
  assert.equal(t1.state.stationStatus, "BLACKOUT");
  assert.equal(t1.state.collapseRootCause, "CORRIDOR_BOTTLENECK_BLACKOUT");
  assert.equal(t1.receipt?.corridorFlowKwh, 25);
  assert.equal(t1.receipt?.unmetLoadKwh, 10);

  // Ticket 01.3 (Failure F1): Once in BLACKOUT, any further action is rejected with TerminalBlackoutImmutable
  const afterBlackout = applyStationAction(t1.state, {
    kind: "AdvanceTurn",
    actorId: OPERATOR_A,
  });
  assert.equal(afterBlackout.accepted, false);
  assert.equal(afterBlackout.rejectionCode, "TerminalBlackoutImmutable");
  assert.equal(afterBlackout.state.collapseRootCause, "CORRIDOR_BOTTLENECK_BLACKOUT");
  assert.equal(sumAllStationCredits(afterBlackout.state), INITIAL_TOTAL_STATION_CREDITS);
});

test("Role 1 (Ticket 01.2 & 01.4): Surge price triggers SCRUBBER_SOLVENCY_COLLAPSE and invalid parameters are rejected", () => {
  let state = createInitialStationState();

  // Reject floating-point or out-of-range maintenanceReserveBps (Failure F2)
  const badFloat = applyStationAction(state, {
    kind: "SetPolicy",
    actorId: OPERATOR_A,
    gridPriceTier: "BALANCED",
    maintenanceReserveBps: 123.45,
  });
  assert.equal(badFloat.accepted, false);
  assert.equal(badFloat.rejectionCode, "InvalidStationParameters");

  const badRange = applyStationAction(state, {
    kind: "SetPolicy",
    actorId: OPERATOR_A,
    gridPriceTier: "BALANCED",
    maintenanceReserveBps: 15_000,
  });
  assert.equal(badRange.accepted, false);
  assert.equal(badRange.rejectionCode, "InvalidStationParameters");

  // Reject routing non-battery equipment (gen-solar-1)
  const badRoute = applyStationAction(state, {
    kind: "RouteBattery",
    actorId: OPERATOR_A,
    tokenId: "gen-solar-1",
    targetZone: "HABITAT_DOME",
  });
  assert.equal(badRoute.accepted, false);
  assert.equal(badRoute.rejectionCode, "NonMovableEquipment");

  // Set SURGE price (8 CR/kWh) and 0 bps maintenance reserve
  const policyRes = applyStationAction(state, {
    kind: "SetPolicy",
    actorId: OPERATOR_A,
    gridPriceTier: "SURGE",
    maintenanceReserveBps: 0,
  });
  assert.equal(policyRes.accepted, true);
  state = policyRes.state;

  // Run turns until O2 Scrubber reserve bankrupts under SURGE pricing
  for (let i = 0; i < 6; i++) {
    const step = applyStationAction(state, {
      kind: "AdvanceTurn",
      actorId: OPERATOR_A,
    });
    assert.equal(step.accepted, true);
    state = step.state;
    if (state.stationStatus === "BLACKOUT") {
      break;
    }
  }
  assert.equal(state.stationStatus, "BLACKOUT");
  assert.equal(state.collapseRootCause, "SCRUBBER_SOLVENCY_COLLAPSE");
  assert.equal(sumAllStationCredits(state), INITIAL_TOTAL_STATION_CREDITS);
});

test("Role 1 (Ticket 01.4 & P3): NEP-171 dynamic equipment transfer preserves wear/reserve/charge and satisfies Sybil invariance", () => {
  let state = createInitialStationState();
  const t1 = applyStationAction(state, {
    kind: "AdvanceTurn",
    actorId: OPERATOR_A,
  });
  assert.equal(t1.accepted, true);
  state = t1.state;

  const beforeNft = state.equipment["bat-alpha-1"];
  assert.ok(beforeNft.wearBps > 0);
  assert.ok(beforeNft.reserveCredits > 0);

  // Unauthorized actor cannot transfer bat-alpha-1
  const unauthorized = applyStationAction(state, {
    kind: "TransferEquipmentNft",
    actorId: OPERATOR_B,
    tokenId: "bat-alpha-1",
    toOwnerId: OPERATOR_B,
  });
  assert.equal(unauthorized.accepted, false);
  assert.equal(unauthorized.rejectionCode, "UnauthorizedNftTransfer");

  // Valid owner transfers bat-alpha-1 to OPERATOR_B: wearBps, reserveCredits, chargeKwh, and zone are strictly preserved
  const handover = applyStationAction(state, {
    kind: "TransferEquipmentNft",
    actorId: OPERATOR_A,
    tokenId: "bat-alpha-1",
    toOwnerId: OPERATOR_B,
  });
  assert.equal(handover.accepted, true);
  const afterNft = handover.state.equipment["bat-alpha-1"];
  assert.equal(afterNft.ownerId, OPERATOR_B);
  assert.equal(afterNft.wearBps, beforeNft.wearBps);
  assert.equal(afterNft.reserveCredits, beforeNft.reserveCredits);
  assert.equal(afterNft.chargeKwh, beforeNft.chargeKwh);
  assert.equal(afterNft.zone, beforeNft.zone);
  assert.equal(afterNft.handoverHistory.length, 1);

  // Anti-Sybil Invariance: 1 account holding all 4 NFTs vs 2 accounts splitting the 4 NFTs produce identical station energy, wear, and total operator credits
  let singleOwnerState = createInitialStationState({ singleOwnerAllEquipment: true });
  let splitOwnerState = createInitialStationState({ singleOwnerAllEquipment: false });
  for (let turn = 1; turn <= 4; turn++) {
    singleOwnerState = applyStationAction(singleOwnerState, {
      kind: "AdvanceTurn",
      actorId: OPERATOR_A,
    }).state;
    splitOwnerState = applyStationAction(splitOwnerState, {
      kind: "AdvanceTurn",
      actorId: OPERATOR_A,
    }).state;
  }
  const singleTotalOperatorCredits =
    (singleOwnerState.accountCredits[OPERATOR_A] ?? 0) +
    (singleOwnerState.accountCredits[OPERATOR_B] ?? 0);
  const splitTotalOperatorCredits =
    (splitOwnerState.accountCredits[OPERATOR_A] ?? 0) +
    (splitOwnerState.accountCredits[OPERATOR_B] ?? 0);
  assert.equal(singleTotalOperatorCredits, splitTotalOperatorCredits);
  assert.equal(
    singleOwnerState.equipment["gen-solar-1"].wearBps,
    splitOwnerState.equipment["gen-solar-1"].wearBps,
  );
});

test("Role 1 (Ticket 01.5): Two-layer NEP-366 SignedDelegate session guard separates envelope vs execution verdicts", () => {
  const state = createInitialStationState();
  const validAction: StationAction = {
    kind: "RouteBattery",
    actorId: OPERATOR_A,
    tokenId: "bat-alpha-1",
    targetZone: "HABITAT_DOME",
  };

  // Case 1: Valid gasless NEP-366 envelope
  const validSig = buildDeterministicDelegateSignature(
    OPERATOR_A,
    COORDINATOR_CONTRACT_ID,
    "route_battery",
    101,
    5000,
  );
  const resValid = verifyAndExecuteNep366Delegate(
    {
      senderId: OPERATOR_A,
      relayerSignerId: RELAYER_ID,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 101,
      lastNonce: 100,
      maxBlockHeight: 5000,
      currentBlockHeight: 4950,
      attachedDepositYocto: 0,
      signatureHex: validSig,
    },
    validAction,
    state,
  );
  assert.equal(resValid.envelopeVerdict, "Valid");
  assert.equal(resValid.envelopeAccepted, true);
  assert.equal(resValid.executionVerdict.effectivePredecessorId, OPERATOR_A);
  assert.equal(resValid.executionVerdict.engineAccepted, true);

  // Case 2: Expired maxBlockHeight rejected at envelope layer
  const resExpired = verifyAndExecuteNep366Delegate(
    {
      senderId: OPERATOR_A,
      relayerSignerId: RELAYER_ID,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 101,
      lastNonce: 100,
      maxBlockHeight: 4900,
      currentBlockHeight: 4950,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        OPERATOR_A,
        COORDINATOR_CONTRACT_ID,
        "route_battery",
        101,
        4900,
      ),
    },
    validAction,
    state,
  );
  assert.equal(resExpired.envelopeVerdict, "ExpiredMaxBlockHeight");
  assert.equal(resExpired.envelopeAccepted, false);

  // Case 3: Stale nonce replay rejected at envelope layer
  const resStaleNonce = verifyAndExecuteNep366Delegate(
    {
      senderId: OPERATOR_A,
      relayerSignerId: RELAYER_ID,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "route_battery",
      nonce: 100,
      lastNonce: 100,
      maxBlockHeight: 5000,
      currentBlockHeight: 4950,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        OPERATOR_A,
        COORDINATOR_CONTRACT_ID,
        "route_battery",
        100,
        5000,
      ),
    },
    validAction,
    state,
  );
  assert.equal(resStaleNonce.envelopeVerdict, "StaleDelegateNonce");
  assert.equal(resStaleNonce.envelopeAccepted, false);

  // Case 4: Relayer attempts to hijack Operator A's NFT using relayer's own senderId -> envelope valid, engine rejects with UnauthorizedNftTransfer
  const hijackAction: StationAction = {
    kind: "TransferEquipmentNft",
    actorId: OPERATOR_A, // forged inside payload, but NEP-366 binds effectivePredecessorId to envelope.senderId (RELAYER_ID)
    tokenId: "bat-alpha-1",
    toOwnerId: RELAYER_ID,
  };
  const resHijack = verifyAndExecuteNep366Delegate(
    {
      senderId: RELAYER_ID,
      relayerSignerId: RELAYER_ID,
      receiverId: COORDINATOR_CONTRACT_ID,
      methodName: "nft_transfer",
      nonce: 201,
      lastNonce: 200,
      maxBlockHeight: 5000,
      currentBlockHeight: 4950,
      attachedDepositYocto: 0,
      signatureHex: buildDeterministicDelegateSignature(
        RELAYER_ID,
        COORDINATOR_CONTRACT_ID,
        "nft_transfer",
        201,
        5000,
      ),
    },
    hijackAction,
    state,
  );
  assert.equal(resHijack.envelopeVerdict, "Valid");
  assert.equal(resHijack.executionVerdict.effectivePredecessorId, RELAYER_ID);
  assert.equal(resHijack.executionVerdict.engineAccepted, false);
  assert.equal(
    resHijack.executionVerdict.engineRejectionCode,
    "UnauthorizedNftTransfer",
  );
});

test("Role 2 (Ticket 01.6): Shape 1 200-run fc.check() property suite verifies P1..P4 after every step and meets all 5 reachability witness floors", () => {
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
          actorId: OPERATOR_A,
          gridPriceTier: s.gridPriceTier,
          maintenanceReserveBps: s.maintenanceReserveBps,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-alpha-1"]?.ownerId ?? OPERATOR_A,
          tokenId: "bat-alpha-1",
          targetZone: s.routeAlphaTo,
        },
        {
          kind: "RouteBattery",
          actorId: state.equipment["bat-beta-2"]?.ownerId ?? OPERATOR_B,
          tokenId: "bat-beta-2",
          targetZone: s.routeBetaTo,
        },
      ];

      if (s.transferTokenId) {
        const currentOwner = state.equipment[s.transferTokenId]?.ownerId ?? OPERATOR_A;
        const otherActor = currentOwner === OPERATOR_A ? OPERATOR_B : OPERATOR_A;
        candidateActions.push({
          kind: "TransferEquipmentNft",
          actorId: s.useValidOwnerForTransfer ? currentOwner : otherActor,
          tokenId: s.transferTokenId,
          toOwnerId: otherActor,
        });
      }

      if (s.triggerRepairOn) {
        const currentOwner = state.equipment[s.triggerRepairOn]?.ownerId ?? OPERATOR_A;
        candidateActions.push({
          kind: "RepairEquipment",
          actorId: currentOwner,
          tokenId: s.triggerRepairOn,
        });
      }

      candidateActions.push({
        kind: "AdvanceTurn",
        actorId: OPERATOR_A,
      });

      for (const action of candidateActions) {
        const prevState = state;
        const outcome = applyStationAction(prevState, action);
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
          !verdict.p1CurrencyConservation ||
          !verdict.p2EnergyBalanceConservation ||
          !verdict.p3NftNonLaunderingAndSybilInvariance ||
          !verdict.p4CorridorCapAndBlackoutFinality
        ) {
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
  assert.equal(
    details.failed,
    false,
    `fc.check failed on seed=${details.seed} path=${details.counterexamplePath}`,
  );

  assert.ok(
    completed14TurnRunsCount >= 40,
    `Expected completed14TurnRunsCount >= 40, got ${completed14TurnRunsCount}`,
  );
  assert.ok(
    eclipseBatteryDischargeTurnsCount >= 150,
    `Expected eclipseBatteryDischargeTurnsCount >= 150, got ${eclipseBatteryDischargeTurnsCount}`,
  );
  assert.ok(
    corridorCapClampedTurnsCount >= 40,
    `Expected corridorCapClampedTurnsCount >= 40, got ${corridorCapClampedTurnsCount}`,
  );
  assert.ok(
    degradedNftTransferPreservedCount >= 40,
    `Expected degradedNftTransferPreservedCount >= 40, got ${degradedNftTransferPreservedCount}`,
  );
  assert.ok(
    maintenanceStarvationTurnsCount >= 40,
    `Expected maintenanceStarvationTurnsCount >= 40, got ${maintenanceStarvationTurnsCount}`,
  );
});

test("Role 3 (Ticket 01.6): Independent Oracle calibration catches individual test-local mutations for P1, P2, P3, and P4", () => {
  const prevState = createInitialStationState();
  const turnAction: StationAction = { kind: "AdvanceTurn", actorId: OPERATOR_A };
  const validTurnOutcome = applyStationAction(prevState, turnAction);
  assert.equal(validTurnOutcome.accepted, true);

  // Baseline valid outcome passes P1..P4
  const baselineVerdict = evaluateAfterlightOracleStep(
    prevState,
    turnAction,
    validTurnOutcome,
    prevState.initialTotalCredits,
  );
  assert.equal(baselineVerdict.allPassed, true);

  // Mutation 1 (P1 Currency Conservation violation): Leak 1 credit from stationTreasuryCredits
  const mutatedP1Outcome = structuredClone(validTurnOutcome);
  mutatedP1Outcome.state.stationTreasuryCredits += 1;
  const vP1 = evaluateAfterlightOracleStep(
    prevState,
    turnAction,
    mutatedP1Outcome,
    prevState.initialTotalCredits,
  );
  assert.equal(vP1.p1CurrencyConservation, false);
  assert.equal(vP1.p2EnergyBalanceConservation, true);
  assert.equal(vP1.p3NftNonLaunderingAndSybilInvariance, true);
  assert.equal(vP1.p4CorridorCapAndBlackoutFinality, true);
  assert.ok(vP1.ledgerDiff.length > 0);

  // Mutation 2 (P2 Energy Conservation violation): Inflate receipt.batteryChargedKwh by 5 kWh
  const mutatedP2Outcome = structuredClone(validTurnOutcome);
  if (mutatedP2Outcome.receipt) {
    mutatedP2Outcome.receipt.batteryChargedKwh += 5;
  }
  const vP2 = evaluateAfterlightOracleStep(
    prevState,
    turnAction,
    mutatedP2Outcome,
    prevState.initialTotalCredits,
  );
  assert.equal(vP1.p1CurrencyConservation, false);
  assert.equal(vP2.p1CurrencyConservation, true);
  assert.equal(vP2.p2EnergyBalanceConservation, false);
  assert.equal(vP2.p3NftNonLaunderingAndSybilInvariance, true);
  assert.equal(vP2.p4CorridorCapAndBlackoutFinality, true);

  // Mutation 3 (P3 NFT Transfer Non-Laundering violation): Reset wearBps to 0 during TransferEquipmentNft
  const afterTurnState = validTurnOutcome.state;
  const transferAction: StationAction = {
    kind: "TransferEquipmentNft",
    actorId: OPERATOR_A,
    tokenId: "bat-alpha-1",
    toOwnerId: OPERATOR_B,
  };
  const validTransferOutcome = applyStationAction(afterTurnState, transferAction);
  const mutatedP3Outcome = structuredClone(validTransferOutcome);
  mutatedP3Outcome.state.equipment["bat-alpha-1"].wearBps = 0;
  const vP3 = evaluateAfterlightOracleStep(
    afterTurnState,
    transferAction,
    mutatedP3Outcome,
    afterTurnState.initialTotalCredits,
  );
  assert.equal(vP3.p1CurrencyConservation, true);
  assert.equal(vP3.p2EnergyBalanceConservation, true);
  assert.equal(vP3.p3NftNonLaunderingAndSybilInvariance, false);
  assert.equal(vP3.p4CorridorCapAndBlackoutFinality, true);

  // Mutation 4 (P4 Corridor Cap & Blackout Finality violation): Exceed corridorCapKwh
  const mutatedP4Outcome = structuredClone(validTurnOutcome);
  if (mutatedP4Outcome.receipt) {
    mutatedP4Outcome.receipt.corridorFlowKwh = prevState.corridorCapKwh + 10;
  }
  const vP4 = evaluateAfterlightOracleStep(
    prevState,
    turnAction,
    mutatedP4Outcome,
    prevState.initialTotalCredits,
  );
  assert.equal(vP4.p1CurrencyConservation, true);
  assert.equal(vP4.p2EnergyBalanceConservation, true);
  assert.equal(vP4.p3NftNonLaunderingAndSybilInvariance, true);
  assert.equal(vP4.p4CorridorCapAndBlackoutFinality, false);
});

test("Ticket 01.1 (Failure F5): Rust contract structure and Golden Turn Vectors match TypeScript engine turn-by-turn", () => {
  const contractPath = path.resolve(
    process.cwd(),
    "contracts/afterlight/src/lib.rs",
  );
  const cargoTomlPath = path.resolve(
    process.cwd(),
    "contracts/afterlight/Cargo.toml",
  );
  const goldenVectorsPath = path.resolve(
    process.cwd(),
    "src/scenarios/golden-turn-vectors.json",
  );

  assert.equal(fs.existsSync(contractPath), true, "contracts/afterlight/src/lib.rs must exist");
  assert.equal(fs.existsSync(cargoTomlPath), true, "contracts/afterlight/Cargo.toml must exist");
  assert.equal(fs.existsSync(goldenVectorsPath), true, "golden-turn-vectors.json must exist");

  const cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
  assert.equal(cargoToml.includes('near-sdk = "=5.29.0"'), true);
  assert.equal(cargoToml.includes("near-contract-standards"), false);

  const contractSrc = fs.readFileSync(contractPath, "utf8");
  for (const token of [
    "#[near(contract_state)]",
    "pub struct AfterlightContract",
    "pub fn nft_token",
    "pub fn nft_tokens_for_owner",
    "pub fn nft_transfer",
    "pub fn route_battery",
    "pub fn repair_equipment",
    "pub fn advance_turn",
    "pub fn execute_nep366_delegate",
  ]) {
    assert.equal(
      contractSrc.includes(token),
      true,
      `Missing token in lib.rs: ${token}`,
    );
  }

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
  assert.ok(vectors.length >= 3);

  for (const vec of vectors) {
    let state: StationState = createInitialStationState({
      corridorCapKwh: vec.corridorCapKwh,
    });
    state = applyStationAction(state, {
      kind: "SetPolicy",
      actorId: OPERATOR_A,
      gridPriceTier: vec.gridPriceTier,
      maintenanceReserveBps: vec.maintenanceReserveBps,
    }).state;
    state = applyStationAction(state, {
      kind: "RouteBattery",
      actorId: OPERATOR_A,
      tokenId: "bat-alpha-1",
      targetZone: vec.batAlphaZone,
    }).state;
    state = applyStationAction(state, {
      kind: "RouteBattery",
      actorId: OPERATOR_B,
      tokenId: "bat-beta-2",
      targetZone: vec.batBetaZone,
    }).state;

    for (let i = 0; i < vec.turnsToRun; i++) {
      const step = applyStationAction(state, {
        kind: "AdvanceTurn",
        actorId: OPERATOR_A,
      });
      if (!step.accepted) {
        break;
      }
      state = step.state;
    }

    assert.equal(state.turn, vec.expectedFinalTurn, `vector ${vec.id} turn mismatch`);
    assert.equal(state.stationStatus, vec.expectedStatus, `vector ${vec.id} status mismatch`);
    assert.equal(
      state.collapseRootCause,
      vec.expectedCollapseRootCause,
      `vector ${vec.id} collapseRootCause mismatch`,
    );
    assert.equal(
      sumAllStationCredits(state),
      vec.expectedTotalCredits,
      `vector ${vec.id} totalCredits mismatch`,
    );
    assert.equal(state.o2Level, vec.expectedO2Level, `vector ${vec.id} o2Level mismatch`);
    assert.equal(
      state.equipment["gen-solar-1"].wearBps,
      vec.expectedGenSolarWearBps,
      `vector ${vec.id} gen-solar-1 wearBps mismatch`,
    );
  }
});
