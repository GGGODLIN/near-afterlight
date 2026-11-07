import type {
  StationAction,
  StationActionOutcome,
  StationState,
} from "./afterlight-engine.ts";

export interface LedgerFieldDiff {
  fieldPath: string;
  engineValue: number | string;
  oracleValue: number | string;
  delta: number | string;
}

export interface AfterlightStepOracleVerdict {
  allPassed: boolean;
  p1CurrencyConservation: boolean;
  p2EnergyBalanceConservation: boolean;
  p3NftNonLaunderingAndSybilInvariance: boolean;
  p4CorridorCapAndBlackoutFinality: boolean;
  violatedInvariants: Array<"P1" | "P2" | "P3" | "P4">;
  ledgerDiff: LedgerFieldDiff[];
  failureDetails: string[];
}

export function evaluateAfterlightOracleStep(
  prevState: Readonly<StationState>,
  action: StationAction,
  outcome: Readonly<StationActionOutcome>,
  initialTotalCredits: number,
): AfterlightStepOracleVerdict {
  const ledgerDiff: LedgerFieldDiff[] = [];
  const failureDetails: string[] = [];

  const nextState = outcome.state;

  // --- P1: Closed-Loop Currency Conservation & Exact Integer Split ---
  let p1CurrencyConservation = true;

  const accountEntries = Object.entries(nextState.accountCredits);
  const equipmentEntries = Object.entries(nextState.equipment);

  let accountsSum = 0;
  for (const [acct, bal] of accountEntries) {
    if (!Number.isSafeInteger(bal) || bal < 0) {
      p1CurrencyConservation = false;
      failureDetails.push(`P1: Account ${acct} has invalid credit balance ${bal}`);
    }
    accountsSum += bal;
  }

  let reservesSum = 0;
  for (const [tokenId, eq] of equipmentEntries) {
    if (!Number.isSafeInteger(eq.reserveCredits) || eq.reserveCredits < 0) {
      p1CurrencyConservation = false;
      failureDetails.push(
        `P1: Equipment ${tokenId} has invalid reserveCredits ${eq.reserveCredits}`,
      );
    }
    reservesSum += eq.reserveCredits;
  }

  if (
    !Number.isSafeInteger(nextState.colonistDemandPoolCredits) ||
    nextState.colonistDemandPoolCredits < 0 ||
    !Number.isSafeInteger(nextState.stationTreasuryCredits) ||
    nextState.stationTreasuryCredits < 0
  ) {
    p1CurrencyConservation = false;
    failureDetails.push("P1: Colonist demand pool or station treasury is negative");
  }

  const computedTotalCredits =
    accountsSum +
    reservesSum +
    nextState.colonistDemandPoolCredits +
    nextState.stationTreasuryCredits;

  if (computedTotalCredits !== initialTotalCredits) {
    p1CurrencyConservation = false;
    ledgerDiff.push({
      fieldPath: "systemTotalCredits",
      engineValue: computedTotalCredits,
      oracleValue: initialTotalCredits,
      delta: computedTotalCredits - initialTotalCredits,
    });
    failureDetails.push(
      `P1: Total credits ${computedTotalCredits} !== initialTotalCredits ${initialTotalCredits}`,
    );
  }

  if (outcome.receipt) {
    const r = outcome.receipt;
    if (
      r.retainedToReserveCredits + r.ownerPayoutCredits !==
      r.grossRevenueCredits
    ) {
      p1CurrencyConservation = false;
      ledgerDiff.push({
        fieldPath: "receipt.grossRevenueSplit",
        engineValue: r.retainedToReserveCredits + r.ownerPayoutCredits,
        oracleValue: r.grossRevenueCredits,
        delta:
          r.retainedToReserveCredits +
          r.ownerPayoutCredits -
          r.grossRevenueCredits,
      });
      failureDetails.push("P1: Revenue split does not sum to grossRevenueCredits");
    }
  }

  // --- P2: Energy & O2 Balance Conservation ---
  let p2EnergyBalanceConservation = true;

  if (outcome.receipt) {
    const r = outcome.receipt;
    const totalEnergyIn = r.solarGeneratedKwh + r.batteryDischargedKwh;
    const totalEnergyOut =
      r.habitatConsumedKwh +
      r.scrubberConsumedKwh +
      r.batteryChargedKwh +
      r.corridorLossKwh +
      r.curtailedKwh;

    if (totalEnergyIn !== totalEnergyOut) {
      p2EnergyBalanceConservation = false;
      ledgerDiff.push({
        fieldPath: "receipt.energyBalanceKwh",
        engineValue: totalEnergyOut,
        oracleValue: totalEnergyIn,
        delta: totalEnergyOut - totalEnergyIn,
      });
      failureDetails.push(
        `P2: Energy out ${totalEnergyOut} kWh !== Energy in ${totalEnergyIn} kWh`,
      );
    }
  }

  for (const [tokenId, eq] of equipmentEntries) {
    const oracleEffCap = Math.trunc(
      (eq.maxCapacityKwh * (10_000 - eq.wearBps)) / 10_000,
    );
    if (eq.chargeKwh < 0 || eq.chargeKwh > oracleEffCap) {
      p2EnergyBalanceConservation = false;
      ledgerDiff.push({
        fieldPath: `equipment.${tokenId}.chargeKwh`,
        engineValue: eq.chargeKwh,
        oracleValue: oracleEffCap,
        delta: eq.chargeKwh - oracleEffCap,
      });
      failureDetails.push(
        `P2: Battery ${tokenId} charge ${eq.chargeKwh} exceeds effective capacity ${oracleEffCap}`,
      );
    }
  }

  // --- P3: NEP-171 Transfer Non-Laundering & Anti-Sybil Invariance ---
  let p3NftNonLaunderingAndSybilInvariance = true;

  if (action.kind === "TransferEquipmentNft") {
    const prevEq = prevState.equipment[action.tokenId];
    const nextEq = nextState.equipment[action.tokenId];

    if (prevEq && nextEq) {
      const callerIsOwner =
        prevState.stationStatus !== "BLACKOUT" &&
        prevEq.ownerId === action.actorId &&
        Boolean(action.toOwnerId) &&
        action.toOwnerId !== prevEq.ownerId;

      if (!callerIsOwner && outcome.accepted) {
        p3NftNonLaunderingAndSybilInvariance = false;
        failureDetails.push("P3: Unauthorized NFT transfer was accepted");
      }

      if (
        nextEq.wearBps !== prevEq.wearBps ||
        nextEq.reserveCredits !== prevEq.reserveCredits ||
        nextEq.chargeKwh !== prevEq.chargeKwh ||
        nextEq.zone !== prevEq.zone
      ) {
        p3NftNonLaunderingAndSybilInvariance = false;
        ledgerDiff.push({
          fieldPath: `equipment.${action.tokenId}.wearBps`,
          engineValue: nextEq.wearBps,
          oracleValue: prevEq.wearBps,
          delta: nextEq.wearBps - prevEq.wearBps,
        });
        failureDetails.push(
          `P3: NFT transfer mutated wearBps/reserveCredits/chargeKwh/zone on ${action.tokenId}`,
        );
      }
    }
  }

  // --- P4: Transmission Corridor Capacity Cap & Terminal Blackout Finality ---
  let p4CorridorCapAndBlackoutFinality = true;

  if (outcome.receipt) {
    if (
      outcome.receipt.corridorFlowKwh < 0 ||
      outcome.receipt.corridorFlowKwh > prevState.corridorCapKwh
    ) {
      p4CorridorCapAndBlackoutFinality = false;
      ledgerDiff.push({
        fieldPath: "receipt.corridorFlowKwh",
        engineValue: outcome.receipt.corridorFlowKwh,
        oracleValue: prevState.corridorCapKwh,
        delta: outcome.receipt.corridorFlowKwh - prevState.corridorCapKwh,
      });
      failureDetails.push(
        `P4: corridorFlowKwh ${outcome.receipt.corridorFlowKwh} exceeded cap ${prevState.corridorCapKwh}`,
      );
    }
  }

  if (prevState.stationStatus === "BLACKOUT") {
    if (
      outcome.accepted ||
      nextState.stationStatus !== "BLACKOUT" ||
      nextState.collapseRootCause !== prevState.collapseRootCause ||
      nextState.turn !== prevState.turn
    ) {
      p4CorridorCapAndBlackoutFinality = false;
      failureDetails.push("P4: Terminal BLACKOUT state was mutated");
    }
  }

  if (nextState.stationStatus === "BLACKOUT" && !nextState.collapseRootCause) {
    p4CorridorCapAndBlackoutFinality = false;
    failureDetails.push("P4: BLACKOUT state missing collapseRootCause");
  }

  const violatedInvariants: Array<"P1" | "P2" | "P3" | "P4"> = [];
  if (!p1CurrencyConservation) violatedInvariants.push("P1");
  if (!p2EnergyBalanceConservation) violatedInvariants.push("P2");
  if (!p3NftNonLaunderingAndSybilInvariance) violatedInvariants.push("P3");
  if (!p4CorridorCapAndBlackoutFinality) violatedInvariants.push("P4");

  return {
    allPassed: violatedInvariants.length === 0,
    p1CurrencyConservation,
    p2EnergyBalanceConservation,
    p3NftNonLaunderingAndSybilInvariance,
    p4CorridorCapAndBlackoutFinality,
    violatedInvariants,
    ledgerDiff,
    failureDetails,
  };
}
