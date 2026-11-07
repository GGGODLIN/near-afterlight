import {
  AUTO_REPAIR_COST_CREDITS,
  AUTO_REPAIR_WEAR_RECOVERY_BPS,
  BASE_SOLAR_GENERATION_KWH,
  BATTERY_BASE_CAPACITY_KWH,
  CRITICAL_WEAR_THRESHOLD_BPS,
  DEFAULT_CORRIDOR_CAP_KWH,
  GRID_PRICE_TIERS,
  HABITAT_BASE_LOAD_KWH,
  INITIAL_TOTAL_STATION_CREDITS,
  ORBIT_WEEK_TURNS,
  SCRUBBER_BASE_LOAD_KWH,
  WEAR_PER_ACTIVE_TURN_BPS,
  type GridPriceTierKey,
} from "./constants.ts";

export type EquipmentKind = "SOLAR_GENERATOR" | "STORAGE_BATTERY" | "O2_SCRUBBER";
export type OrbitalPhase = "DAYLIGHT" | "ECLIPSE";
export type StationStatus = "ACTIVE" | "BLACKOUT" | "SURVIVED";
export type CollapseRootCause =
  | "CORRIDOR_BOTTLENECK_BLACKOUT"
  | "SCRUBBER_SOLVENCY_COLLAPSE"
  | "UNMAINTAINED_CAPACITY_DECAY";

export type StationRejectionCode =
  | "TerminalBlackoutImmutable"
  | "InvalidStationParameters"
  | "UnauthorizedNftTransfer"
  | "NonMovableEquipment"
  | "InsufficientRepairReserve"
  | "OrbitScheduleCompleted";

export interface EquipmentNftState {
  tokenId: string;
  name: string;
  kind: EquipmentKind;
  ownerId: string;
  zone: "SOLAR_ARRAY" | "HABITAT_DOME";
  chargeKwh: number;
  maxCapacityKwh: number;
  wearBps: number;
  reserveCredits: number;
  cumulativeEarnedCredits: number;
  transferCount: number;
}

export interface TurnAccountingReceipt {
  turn: number;
  orbitalPhase: OrbitalPhase;
  gridPriceTier: GridPriceTierKey;
  gridPricePerKwh: number;
  maintenanceReserveBps: number;
  solarGeneratedKwh: number;
  batteryDischargedKwh: number;
  habitatConsumedKwh: number;
  scrubberConsumedKwh: number;
  batteryChargedKwh: number;
  corridorFlowKwh: number;
  corridorClampedKwh: number;
  corridorLossKwh: number;
  curtailedKwh: number;
  unmetLoadKwh: number;
  grossRevenueCredits: number;
  retainedToReserveCredits: number;
  ownerPayoutCredits: number;
  repairSpentToTreasuryCredits: number;
  o2Before: number;
  o2After: number;
  stationStatusAfter: StationStatus;
  collapseRootCause: CollapseRootCause | null;
}

export interface StationState {
  turn: number;
  maxTurns: number;
  stationStatus: StationStatus;
  collapseRootCause: CollapseRootCause | null;
  corridorCapKwh: number;
  o2Level: number;
  gridPriceTier: GridPriceTierKey;
  gridPricePerKwh: number;
  maintenanceReserveBps: number;
  initialTotalCredits: number;
  accountCredits: Record<string, number>;
  colonistDemandPoolCredits: number;
  stationTreasuryCredits: number;
  equipment: Record<string, EquipmentNftState>;
  turnHistory: TurnAccountingReceipt[];
}

export type StationAction =
  | {
      kind: "SetPolicy";
      actorId: string;
      gridPriceTier: GridPriceTierKey;
      maintenanceReserveBps: number;
    }
  | {
      kind: "RouteBattery";
      actorId: string;
      tokenId: string;
      targetZone: "SOLAR_ARRAY" | "HABITAT_DOME";
    }
  | {
      kind: "TransferEquipmentNft";
      actorId: string;
      tokenId: string;
      toOwnerId: string;
    }
  | {
      kind: "RepairEquipment";
      actorId: string;
      tokenId: string;
    }
  | {
      kind: "AdvanceTurn";
      actorId: string;
    };

export interface StationActionOutcome {
  accepted: boolean;
  rejectionCode: StationRejectionCode | null;
  state: StationState;
  receipt: TurnAccountingReceipt | null;
}

export interface InitialStationConfig {
  corridorCapKwh?: number;
  singleOwnerAllEquipment?: boolean;
}

export const DEFAULT_OPERATOR_A = "commander-a.afterlight.testnet";
export const DEFAULT_OPERATOR_B = "operator-b.afterlight.testnet";

const EQUIPMENT_ORDER = [
  "gen-solar-1",
  "bat-alpha-1",
  "bat-beta-2",
  "o2-scrubber-1",
] as const;

export function effectiveCapacityKwh(maxCapacityKwh: number, wearBps: number): number {
  const clampedWear = Math.max(0, Math.min(10_000, wearBps));
  return Math.trunc((maxCapacityKwh * (10_000 - clampedWear)) / 10_000);
}

export function createInitialStationState(config?: InitialStationConfig): StationState {
  const corridorCapKwh = config?.corridorCapKwh ?? DEFAULT_CORRIDOR_CAP_KWH;
  const secondOwner = config?.singleOwnerAllEquipment
    ? DEFAULT_OPERATOR_A
    : DEFAULT_OPERATOR_B;

  return {
    turn: 0,
    maxTurns: ORBIT_WEEK_TURNS,
    stationStatus: "ACTIVE",
    collapseRootCause: null,
    corridorCapKwh,
    o2Level: 100,
    gridPriceTier: "BALANCED",
    gridPricePerKwh: GRID_PRICE_TIERS.BALANCED,
    maintenanceReserveBps: 2000,
    initialTotalCredits: INITIAL_TOTAL_STATION_CREDITS,
    accountCredits: {
      [DEFAULT_OPERATOR_A]: 1200,
      [DEFAULT_OPERATOR_B]: 1200,
    },
    colonistDemandPoolCredits: 5000,
    stationTreasuryCredits: 1800,
    equipment: {
      "gen-solar-1": {
        tokenId: "gen-solar-1",
        name: "Helios-IX Solar Array",
        kind: "SOLAR_GENERATOR",
        ownerId: DEFAULT_OPERATOR_A,
        zone: "SOLAR_ARRAY",
        chargeKwh: 0,
        maxCapacityKwh: BASE_SOLAR_GENERATION_KWH,
        wearBps: 0,
        reserveCredits: 200,
        cumulativeEarnedCredits: 0,
        transferCount: 0,
      },
      "bat-alpha-1": {
        tokenId: "bat-alpha-1",
        name: "CryoCell Battery Alpha",
        kind: "STORAGE_BATTERY",
        ownerId: DEFAULT_OPERATOR_A,
        zone: "HABITAT_DOME",
        chargeKwh: BATTERY_BASE_CAPACITY_KWH,
        maxCapacityKwh: BATTERY_BASE_CAPACITY_KWH,
        wearBps: 0,
        reserveCredits: 200,
        cumulativeEarnedCredits: 0,
        transferCount: 0,
      },
      "bat-beta-2": {
        tokenId: "bat-beta-2",
        name: "CryoCell Battery Beta",
        kind: "STORAGE_BATTERY",
        ownerId: secondOwner,
        zone: "SOLAR_ARRAY",
        chargeKwh: BATTERY_BASE_CAPACITY_KWH,
        maxCapacityKwh: BATTERY_BASE_CAPACITY_KWH,
        wearBps: 0,
        reserveCredits: 200,
        cumulativeEarnedCredits: 0,
        transferCount: 0,
      },
      "o2-scrubber-1": {
        tokenId: "o2-scrubber-1",
        name: "Aegis-IV O2 Scrubber",
        kind: "O2_SCRUBBER",
        ownerId: secondOwner,
        zone: "HABITAT_DOME",
        chargeKwh: 0,
        maxCapacityKwh: SCRUBBER_BASE_LOAD_KWH,
        wearBps: 0,
        reserveCredits: 200,
        cumulativeEarnedCredits: 0,
        transferCount: 0,
      },
    },
    turnHistory: [],
  };
}

export function sumAllStationCredits(state: Readonly<StationState>): number {
  const accountsSum = Object.values(state.accountCredits).reduce((a, b) => a + b, 0);
  const reservesSum = Object.values(state.equipment).reduce(
    (a, eq) => a + eq.reserveCredits,
    0,
  );
  return (
    accountsSum +
    reservesSum +
    state.colonistDemandPoolCredits +
    state.stationTreasuryCredits
  );
}

function rejectAction(
  state: Readonly<StationState>,
  code: StationRejectionCode,
): StationActionOutcome {
  return {
    accepted: false,
    rejectionCode: code,
    state: structuredClone(state) as StationState,
    receipt: null,
  };
}

export function applyStationAction(
  state: Readonly<StationState>,
  action: StationAction,
): StationActionOutcome {
  if (state.stationStatus === "BLACKOUT") {
    return rejectAction(state, "TerminalBlackoutImmutable");
  }

  if (!action.actorId || typeof action.actorId !== "string") {
    return rejectAction(state, "InvalidStationParameters");
  }

  if (action.kind === "SetPolicy") {
    if (
      !(action.gridPriceTier in GRID_PRICE_TIERS) ||
      !Number.isSafeInteger(action.maintenanceReserveBps) ||
      action.maintenanceReserveBps < 0 ||
      action.maintenanceReserveBps > 10_000
    ) {
      return rejectAction(state, "InvalidStationParameters");
    }
    const next = structuredClone(state) as StationState;
    next.gridPriceTier = action.gridPriceTier;
    next.gridPricePerKwh = GRID_PRICE_TIERS[action.gridPriceTier];
    next.maintenanceReserveBps = action.maintenanceReserveBps;
    return {
      accepted: true,
      rejectionCode: null,
      state: next,
      receipt: null,
    };
  }

  if (action.kind === "RouteBattery") {
    const eq = state.equipment[action.tokenId];
    if (!eq) {
      return rejectAction(state, "InvalidStationParameters");
    }
    if (eq.kind !== "STORAGE_BATTERY") {
      return rejectAction(state, "NonMovableEquipment");
    }
    if (
      action.targetZone !== "SOLAR_ARRAY" &&
      action.targetZone !== "HABITAT_DOME"
    ) {
      return rejectAction(state, "InvalidStationParameters");
    }
    const next = structuredClone(state) as StationState;
    next.equipment[action.tokenId].zone = action.targetZone;
    return {
      accepted: true,
      rejectionCode: null,
      state: next,
      receipt: null,
    };
  }

  if (action.kind === "TransferEquipmentNft") {
    const eq = state.equipment[action.tokenId];
    if (!eq || !action.toOwnerId || typeof action.toOwnerId !== "string") {
      return rejectAction(state, "InvalidStationParameters");
    }
    if (eq.ownerId !== action.actorId || action.toOwnerId === eq.ownerId) {
      return rejectAction(state, "UnauthorizedNftTransfer");
    }
    const next = structuredClone(state) as StationState;
    const targetEq = next.equipment[action.tokenId];
    targetEq.ownerId = action.toOwnerId;
    targetEq.transferCount += 1;
    if (next.accountCredits[action.toOwnerId] === undefined) {
      next.accountCredits[action.toOwnerId] = 0;
    }
    return {
      accepted: true,
      rejectionCode: null,
      state: next,
      receipt: null,
    };
  }

  if (action.kind === "RepairEquipment") {
    const eq = state.equipment[action.tokenId];
    if (!eq) {
      return rejectAction(state, "InvalidStationParameters");
    }
    if (eq.ownerId !== action.actorId) {
      return rejectAction(state, "UnauthorizedNftTransfer");
    }
    if (eq.reserveCredits < AUTO_REPAIR_COST_CREDITS) {
      return rejectAction(state, "InsufficientRepairReserve");
    }
    const next = structuredClone(state) as StationState;
    const targetEq = next.equipment[action.tokenId];
    targetEq.reserveCredits -= AUTO_REPAIR_COST_CREDITS;
    next.stationTreasuryCredits += AUTO_REPAIR_COST_CREDITS;
    targetEq.wearBps = Math.max(0, targetEq.wearBps - 1200);
    if (targetEq.kind === "STORAGE_BATTERY") {
      const effCap = effectiveCapacityKwh(targetEq.maxCapacityKwh, targetEq.wearBps);
      targetEq.chargeKwh = Math.min(targetEq.chargeKwh, effCap);
    }
    return {
      accepted: true,
      rejectionCode: null,
      state: next,
      receipt: null,
    };
  }

  if (action.kind === "AdvanceTurn") {
    if (state.turn >= state.maxTurns || state.stationStatus === "SURVIVED") {
      return rejectAction(state, "OrbitScheduleCompleted");
    }

    const next = structuredClone(state) as StationState;
    const turn = next.turn + 1;
    next.turn = turn;
    const orbitalPhase: OrbitalPhase = turn % 2 === 1 ? "DAYLIGHT" : "ECLIPSE";

    const gen = next.equipment["gen-solar-1"];
    const batAlpha = next.equipment["bat-alpha-1"];
    const batBeta = next.equipment["bat-beta-2"];
    const scrubber = next.equipment["o2-scrubber-1"];
    const batteries = [batAlpha, batBeta];

    // Step 1: Solar Generation (Daylight vs Eclipse)
    const solarGeneratedKwh =
      orbitalPhase === "DAYLIGHT"
        ? effectiveCapacityKwh(gen.maxCapacityKwh, gen.wearBps)
        : 0;

    // Step 2: O2 Scrubber Solvency & Demand Determination
    // Colonists pay 60 CR/turn O2 life-support fee into scrubber reserve; scrubber pays 15 kWh * gridPricePerKwh
    const colonistO2Fee = Math.min(next.colonistDemandPoolCredits, 60);
    next.colonistDemandPoolCredits -= colonistO2Fee;
    scrubber.reserveCredits += colonistO2Fee;
    scrubber.cumulativeEarnedCredits += colonistO2Fee;

    const scrubberPowerBill = SCRUBBER_BASE_LOAD_KWH * next.gridPricePerKwh;
    const scrubberSolvent = scrubber.reserveCredits >= scrubberPowerBill;
    const effectiveScrubberDemandKwh = scrubberSolvent ? SCRUBBER_BASE_LOAD_KWH : 0;

    // In Eclipse (-150C orbital shadow), habitat thermal heaters add +15 kWh (35 kWh habitat + 15 kWh scrubber = 50 kWh > 45 kWh corridor cap)
    const habitatRequiredKwh =
      orbitalPhase === "ECLIPSE"
        ? HABITAT_BASE_LOAD_KWH + 15
        : HABITAT_BASE_LOAD_KWH;
    const totalRequiredLoadKwh = habitatRequiredKwh + SCRUBBER_BASE_LOAD_KWH;
    const solventTargetLoadKwh = habitatRequiredKwh + effectiveScrubberDemandKwh;

    // Step 3: Corridor Transmission & Battery Discharge/Charge (Strict Energy Conservation P2)
    let batteryDischargedKwh = 0;
    let batteryChargedKwh = 0;
    let corridorFlowKwh = 0;
    let corridorClampedKwh = 0;

    // 3a. Direct solar across corridor for Habitat demand
    const desiredSolarToHabitat = Math.min(solarGeneratedKwh, solventTargetLoadKwh);
    const solarToHabitatViaCorridor = Math.min(
      desiredSolarToHabitat,
      next.corridorCapKwh,
    );
    corridorClampedKwh += desiredSolarToHabitat - solarToHabitatViaCorridor;
    corridorFlowKwh += solarToHabitatViaCorridor;

    let remainingHabitatNeed = solventTargetLoadKwh - solarToHabitatViaCorridor;
    let remainingCorridorCap = next.corridorCapKwh - solarToHabitatViaCorridor;
    let remainingSolar = solarGeneratedKwh - solarToHabitatViaCorridor;

    // 3b. Local batteries in HABITAT_DOME discharge without using corridor capacity
    for (const bat of batteries) {
      if (bat.zone === "HABITAT_DOME" && remainingHabitatNeed > 0) {
        const discharge = Math.min(bat.chargeKwh, remainingHabitatNeed);
        bat.chargeKwh -= discharge;
        remainingHabitatNeed -= discharge;
        batteryDischargedKwh += discharge;
      }
    }

    // 3c. Batteries in SOLAR_ARRAY discharge across remaining corridor capacity
    for (const bat of batteries) {
      if (bat.zone === "SOLAR_ARRAY" && remainingHabitatNeed > 0) {
        const available = Math.min(bat.chargeKwh, remainingHabitatNeed);
        const transmitted = Math.min(available, remainingCorridorCap);
        const clamped = available - transmitted;
        bat.chargeKwh -= transmitted;
        remainingHabitatNeed -= transmitted;
        remainingCorridorCap -= transmitted;
        corridorFlowKwh += transmitted;
        corridorClampedKwh += clamped;
        batteryDischargedKwh += transmitted;
      }
    }

    const deliveredToHabitatKwh = solventTargetLoadKwh - remainingHabitatNeed;
    const scrubberConsumedKwh = Math.min(
      deliveredToHabitatKwh,
      effectiveScrubberDemandKwh,
    );
    const habitatConsumedKwh = deliveredToHabitatKwh - scrubberConsumedKwh;
    const unmetLoadKwh = totalRequiredLoadKwh - deliveredToHabitatKwh;

    // 3d. Surplus Daylight solar charges batteries (SOLAR_ARRAY first, then HABITAT_DOME via remaining corridor)
    for (const bat of batteries) {
      if (bat.zone === "SOLAR_ARRAY" && remainingSolar > 0) {
        const effCap = effectiveCapacityKwh(bat.maxCapacityKwh, bat.wearBps);
        const room = Math.max(0, effCap - bat.chargeKwh);
        const charge = Math.min(remainingSolar, room);
        bat.chargeKwh += charge;
        remainingSolar -= charge;
        batteryChargedKwh += charge;
      }
    }

    for (const bat of batteries) {
      if (bat.zone === "HABITAT_DOME" && remainingSolar > 0) {
        const effCap = effectiveCapacityKwh(bat.maxCapacityKwh, bat.wearBps);
        const room = Math.max(0, effCap - bat.chargeKwh);
        const desiredCharge = Math.min(remainingSolar, room);
        const transmittedCharge = Math.min(desiredCharge, remainingCorridorCap);
        const clampedCharge = desiredCharge - transmittedCharge;
        bat.chargeKwh += transmittedCharge;
        remainingSolar -= transmittedCharge;
        remainingCorridorCap -= transmittedCharge;
        corridorFlowKwh += transmittedCharge;
        corridorClampedKwh += clampedCharge;
        batteryChargedKwh += transmittedCharge;
      }
    }

    let curtailedKwh = remainingSolar;
    const corridorLossKwh = 0;

    // Step 4: Credit Settlement & Maintenance Reserve Retention (Strict Currency Conservation P1)
    const scrubberActualBill = scrubberConsumedKwh * next.gridPricePerKwh;
    scrubber.reserveCredits -= scrubberActualBill;

    const habitatRequestedBill = habitatConsumedKwh * next.gridPricePerKwh;
    const habitatActualBill = Math.min(
      next.colonistDemandPoolCredits,
      habitatRequestedBill,
    );
    next.colonistDemandPoolCredits -= habitatActualBill;

    const grossRevenueCredits = scrubberActualBill + habitatActualBill;
    const retainedToReserveCredits = Math.trunc(
      (grossRevenueCredits * next.maintenanceReserveBps) / 10_000,
    );
    const ownerPayoutCredits = grossRevenueCredits - retainedToReserveCredits;

    // Distribute retained reserve and owner payout equally across the 3 power-supplying NFTs (gen-solar-1, bat-alpha-1, bat-beta-2)
    const powerSuppliers = [gen, batAlpha, batBeta];
    const perUnitReserve = Math.trunc(retainedToReserveCredits / 3);
    const reserveRemainder = retainedToReserveCredits - perUnitReserve * 3;
    powerSuppliers[0].reserveCredits += perUnitReserve + reserveRemainder;
    powerSuppliers[1].reserveCredits += perUnitReserve;
    powerSuppliers[2].reserveCredits += perUnitReserve;

    const perUnitPayout = Math.trunc(ownerPayoutCredits / 3);
    const payoutRemainder = ownerPayoutCredits - perUnitPayout * 3;
    const payouts = [
      perUnitPayout + payoutRemainder,
      perUnitPayout,
      perUnitPayout,
    ];
    for (let i = 0; i < powerSuppliers.length; i++) {
      const sup = powerSuppliers[i];
      const amt = payouts[i];
      sup.cumulativeEarnedCredits += amt;
      next.accountCredits[sup.ownerId] =
        (next.accountCredits[sup.ownerId] ?? 0) + amt;
    }

    // Step 5: Wear Accrual & Closed-Loop Auto-Maintenance
    let repairSpentToTreasuryCredits = 0;
    for (const tokenId of EQUIPMENT_ORDER) {
      const eq = next.equipment[tokenId];
      eq.wearBps = Math.min(10_000, eq.wearBps + WEAR_PER_ACTIVE_TURN_BPS);
      if (
        next.maintenanceReserveBps > 0 &&
        eq.reserveCredits >= AUTO_REPAIR_COST_CREDITS
      ) {
        eq.reserveCredits -= AUTO_REPAIR_COST_CREDITS;
        next.stationTreasuryCredits += AUTO_REPAIR_COST_CREDITS;
        repairSpentToTreasuryCredits += AUTO_REPAIR_COST_CREDITS;
        eq.wearBps = Math.max(0, eq.wearBps - AUTO_REPAIR_WEAR_RECOVERY_BPS);
      }
      if (eq.kind === "STORAGE_BATTERY") {
        const newEffCap = effectiveCapacityKwh(eq.maxCapacityKwh, eq.wearBps);
        if (eq.chargeKwh > newEffCap) {
          const shed = eq.chargeKwh - newEffCap;
          eq.chargeKwh = newEffCap;
          batteryDischargedKwh += shed;
          curtailedKwh += shed;
        }
      }
    }

    // Step 6: Vital Signs & Single Root-Cause Blackout Verdict
    const o2Before = next.o2Level;
    let collapseRootCause: CollapseRootCause | null = null;
    const maxWear = Math.max(
      ...EQUIPMENT_ORDER.map((id) => next.equipment[id].wearBps),
    );

    if (!scrubberSolvent) {
      next.o2Level = 0;
      next.stationStatus = "BLACKOUT";
      collapseRootCause = "SCRUBBER_SOLVENCY_COLLAPSE";
    } else if (maxWear >= CRITICAL_WEAR_THRESHOLD_BPS) {
      next.o2Level = 0;
      next.stationStatus = "BLACKOUT";
      collapseRootCause = "UNMAINTAINED_CAPACITY_DECAY";
    } else if (unmetLoadKwh > 0) {
      next.o2Level = 0;
      next.stationStatus = "BLACKOUT";
      collapseRootCause = "CORRIDOR_BOTTLENECK_BLACKOUT";
    } else {
      next.o2Level = 100;
      next.stationStatus = turn >= next.maxTurns ? "SURVIVED" : "ACTIVE";
    }

    next.collapseRootCause = collapseRootCause;

    const receipt: TurnAccountingReceipt = {
      turn,
      orbitalPhase,
      gridPriceTier: next.gridPriceTier,
      gridPricePerKwh: next.gridPricePerKwh,
      maintenanceReserveBps: next.maintenanceReserveBps,
      solarGeneratedKwh,
      batteryDischargedKwh,
      habitatConsumedKwh,
      scrubberConsumedKwh,
      batteryChargedKwh,
      corridorFlowKwh,
      corridorClampedKwh,
      corridorLossKwh,
      curtailedKwh,
      unmetLoadKwh,
      grossRevenueCredits,
      retainedToReserveCredits,
      ownerPayoutCredits,
      repairSpentToTreasuryCredits,
      o2Before,
      o2After: next.o2Level,
      stationStatusAfter: next.stationStatus,
      collapseRootCause,
    };

    next.turnHistory.push(receipt);

    return {
      accepted: true,
      rejectionCode: null,
      state: next,
      receipt,
    };
  }

  return rejectAction(state, "InvalidStationParameters");
}
