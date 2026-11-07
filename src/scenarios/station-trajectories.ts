import type { GridPriceTierKey } from "../engine/constants.ts";
import {
  applyStationAction,
  createInitialStationState,
  DEFAULT_OPERATOR_A,
  DEFAULT_OPERATOR_B,
  type CollapseRootCause,
  type StationState,
  type TurnAccountingReceipt,
} from "../engine/afterlight-engine.ts";

export type TrajectoryPresetId =
  | "01-greedy-surge-collapse"
  | "02-corridor-bottleneck-blackout"
  | "03-balanced-survival-walkthrough";

export interface TurnPolicyStep {
  gridPriceTier: GridPriceTierKey;
  maintenanceReserveBps: number;
  batAlphaZone: "SOLAR_ARRAY" | "HABITAT_DOME";
  batBetaZone: "SOLAR_ARRAY" | "HABITAT_DOME";
  transferTokenId?: string | null;
  transferToOwnerId?: string | null;
}

export interface TrajectorySimulationResult {
  presetId: TrajectoryPresetId | "custom-schedule";
  title: string;
  subtitle: string;
  initialState: StationState;
  finalState: StationState;
  turnSnapshots: StationState[];
  turnReceipts: TurnAccountingReceipt[];
}

interface TrajectoryPresetDescriptor {
  id: TrajectoryPresetId;
  title: string;
  subtitle: string;
  expectedOutcome: "BLACKOUT" | "SURVIVED";
  expectedRootCause: CollapseRootCause | null;
  schedule: TurnPolicyStep[];
}

function buildUniformSchedule(step: TurnPolicyStep, turns = 14): TurnPolicyStep[] {
  return Array.from({ length: turns }, () => ({ ...step }));
}

const PRESET_DESCRIPTORS: TrajectoryPresetDescriptor[] = [
  {
    id: "01-greedy-surge-collapse",
    title: "01. Greedy Price Spike (O2 Scrubber Bankrupts on Turn 4)",
    subtitle:
      "SURGE pricing (8 CR/kWh) + 0 bps maintenance reserve drains Aegis-IV O2 Scrubber reserve by Turn 4.",
    expectedOutcome: "BLACKOUT",
    expectedRootCause: "SCRUBBER_SOLVENCY_COLLAPSE",
    schedule: buildUniformSchedule({
      gridPriceTier: "SURGE",
      maintenanceReserveBps: 0,
      batAlphaZone: "HABITAT_DOME",
      batBetaZone: "SOLAR_ARRAY",
    }),
  },
  {
    id: "02-corridor-bottleneck-blackout",
    title: "02. Corridor Bottleneck (Solar Full, Habitat Blackout on Eclipse Turn 2)",
    subtitle:
      "Both CryoCell batteries remain parked in Solar Array; 45 kWh corridor cap blocks the 50 kWh Eclipse load.",
    expectedOutcome: "BLACKOUT",
    expectedRootCause: "CORRIDOR_BOTTLENECK_BLACKOUT",
    schedule: buildUniformSchedule({
      gridPriceTier: "BALANCED",
      maintenanceReserveBps: 2000,
      batAlphaZone: "SOLAR_ARRAY",
      batBetaZone: "SOLAR_ARRAY",
    }),
  },
  {
    id: "03-balanced-survival-walkthrough",
    title: "03. Balanced Routing & Maintenance (7-Day Survival + Mid-Orbit NFT Handover)",
    subtitle:
      "BALANCED pricing (4 CR/kWh) + 2000 bps auto-repair + split battery staging survives all 14 turns.",
    expectedOutcome: "SURVIVED",
    expectedRootCause: null,
    schedule: buildUniformSchedule({
      gridPriceTier: "BALANCED",
      maintenanceReserveBps: 2000,
      batAlphaZone: "HABITAT_DOME",
      batBetaZone: "SOLAR_ARRAY",
    }).map((s, idx) =>
      idx === 4
        ? {
            ...s,
            transferTokenId: "bat-alpha-1",
            transferToOwnerId: DEFAULT_OPERATOR_B,
          }
        : s,
    ),
  },
];

export function listTrajectoryPresets(): TrajectoryPresetDescriptor[] {
  return structuredClone(PRESET_DESCRIPTORS);
}

export function simulateOrbitWeek(
  initialState: Readonly<StationState>,
  schedule: ReadonlyArray<TurnPolicyStep>,
  presetMeta?: {
    presetId?: TrajectoryPresetId | "custom-schedule";
    title?: string;
    subtitle?: string;
  },
): TrajectorySimulationResult {
  const startState = structuredClone(initialState) as StationState;
  let current = structuredClone(initialState) as StationState;
  const turnSnapshots: StationState[] = [];
  const turnReceipts: TurnAccountingReceipt[] = [];

  for (const step of schedule) {
    if (
      current.stationStatus === "BLACKOUT" ||
      current.stationStatus === "SURVIVED" ||
      current.turn >= current.maxTurns
    ) {
      break;
    }

    const policyOutcome = applyStationAction(current, {
      kind: "SetPolicy",
      actorId: DEFAULT_OPERATOR_A,
      gridPriceTier: step.gridPriceTier,
      maintenanceReserveBps: step.maintenanceReserveBps,
    });
    if (policyOutcome.accepted) {
      current = policyOutcome.state;
    }

    const routeAlpha = applyStationAction(current, {
      kind: "RouteBattery",
      actorId: current.equipment["bat-alpha-1"]?.ownerId ?? DEFAULT_OPERATOR_A,
      tokenId: "bat-alpha-1",
      targetZone: step.batAlphaZone,
    });
    if (routeAlpha.accepted) {
      current = routeAlpha.state;
    }

    const routeBeta = applyStationAction(current, {
      kind: "RouteBattery",
      actorId: current.equipment["bat-beta-2"]?.ownerId ?? DEFAULT_OPERATOR_B,
      tokenId: "bat-beta-2",
      targetZone: step.batBetaZone,
    });
    if (routeBeta.accepted) {
      current = routeBeta.state;
    }

    if (step.transferTokenId && step.transferToOwnerId) {
      const owner =
        current.equipment[step.transferTokenId]?.ownerId ?? DEFAULT_OPERATOR_A;
      const transferOutcome = applyStationAction(current, {
        kind: "TransferEquipmentNft",
        actorId: owner,
        tokenId: step.transferTokenId,
        toOwnerId: step.transferToOwnerId,
      });
      if (transferOutcome.accepted) {
        current = transferOutcome.state;
      }
    }

    const turnOutcome = applyStationAction(current, {
      kind: "AdvanceTurn",
      actorId: DEFAULT_OPERATOR_A,
    });
    if (!turnOutcome.accepted) {
      break;
    }
    current = turnOutcome.state;
    turnSnapshots.push(structuredClone(current) as StationState);
    if (turnOutcome.receipt) {
      turnReceipts.push(structuredClone(turnOutcome.receipt));
    }
  }

  return {
    presetId: presetMeta?.presetId ?? "custom-schedule",
    title: presetMeta?.title ?? "Custom 7-Day Orbital Schedule",
    subtitle:
      presetMeta?.subtitle ??
      "Parametric 14-turn simulation executed by isomorphic station engine.",
    initialState: startState,
    finalState: current,
    turnSnapshots,
    turnReceipts,
  };
}

export function runTrajectoryPreset(
  presetId: TrajectoryPresetId,
): TrajectorySimulationResult {
  const descriptor = PRESET_DESCRIPTORS.find((p) => p.id === presetId);
  if (!descriptor) {
    throw new Error(`Unknown trajectory presetId: ${presetId}`);
  }
  return simulateOrbitWeek(createInitialStationState(), descriptor.schedule, {
    presetId: descriptor.id,
    title: descriptor.title,
    subtitle: descriptor.subtitle,
  });
}
