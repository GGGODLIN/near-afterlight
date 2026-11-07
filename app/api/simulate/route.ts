import { createInitialStationState } from "../../../src/engine/afterlight-engine.ts";
import { buildCollapseAutopsy } from "../../../src/scenarios/collapse-autopsy.ts";
import {
  listTrajectoryPresets,
  runTrajectoryPreset,
  simulateOrbitWeek,
  type TrajectoryPresetId,
  type TurnPolicyStep,
} from "../../../src/scenarios/station-trajectories.ts";

export async function POST(request: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return Response.json(
      {
        error: "InvalidSimulationRequest",
        message: "Request body must be valid JSON",
      },
      { status: 400 },
    );
  }

  if (!parsed || typeof parsed !== "object") {
    return Response.json(
      {
        error: "InvalidSimulationRequest",
        message: "Request body must be a JSON object",
      },
      { status: 400 },
    );
  }

  const body = parsed as {
    presetId?: unknown;
    schedule?: unknown;
  };

  if (body.presetId !== undefined) {
    if (typeof body.presetId !== "string") {
      return Response.json(
        {
          error: "InvalidSimulationRequest",
          message: "presetId must be a string",
        },
        { status: 400 },
      );
    }
    const validIds = new Set(listTrajectoryPresets().map((p) => p.id));
    if (!validIds.has(body.presetId as TrajectoryPresetId)) {
      return Response.json(
        {
          error: "InvalidSimulationRequest",
          message: `Unknown presetId: ${body.presetId}`,
        },
        { status: 400 },
      );
    }
    const sim = runTrajectoryPreset(body.presetId as TrajectoryPresetId);
    return Response.json(
      {
        ...sim,
        nftFleetState: Object.values(sim.finalState.equipment),
        collapseAutopsy: buildCollapseAutopsy(sim.finalState),
      },
      { status: 200 },
    );
  }

  if (
    Array.isArray(body.schedule) &&
    body.schedule.length > 0 &&
    body.schedule.length <= 14
  ) {
    const validTiers = new Set(["SUBSIDIZED", "BALANCED", "SURGE"]);
    const validZones = new Set(["SOLAR_ARRAY", "HABITAT_DOME"]);
    const validTokenIds = new Set([
      "gen-solar-1",
      "bat-alpha-1",
      "bat-beta-2",
      "o2-scrubber-1",
    ]);
    const validAccountPattern = /^[a-z0-9._-]+$/i;
    const forbiddenAccountIds = new Set([
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "valueOf",
    ]);
    const schedule: TurnPolicyStep[] = [];

    for (const rawStep of body.schedule) {
      if (!rawStep || typeof rawStep !== "object") {
        return Response.json(
          {
            error: "InvalidSimulationRequest",
            message: "Each schedule step must be an object",
          },
          { status: 400 },
        );
      }
      const s = rawStep as Record<string, unknown>;
      if (
        typeof s.gridPriceTier !== "string" ||
        !validTiers.has(s.gridPriceTier) ||
        typeof s.maintenanceReserveBps !== "number" ||
        !Number.isSafeInteger(s.maintenanceReserveBps) ||
        s.maintenanceReserveBps < 0 ||
        s.maintenanceReserveBps > 10_000 ||
        typeof s.batAlphaZone !== "string" ||
        !validZones.has(s.batAlphaZone) ||
        typeof s.batBetaZone !== "string" ||
        !validZones.has(s.batBetaZone)
      ) {
        return Response.json(
          {
            error: "InvalidSimulationRequest",
            message: "Invalid schedule step parameters",
          },
          { status: 400 },
        );
      }

      const hasTokenId = s.transferTokenId !== undefined && s.transferTokenId !== null;
      const hasToOwner = s.transferToOwnerId !== undefined && s.transferToOwnerId !== null;
      if (hasTokenId !== hasToOwner) {
        return Response.json(
          {
            error: "InvalidSimulationRequest",
            message: "transferTokenId and transferToOwnerId must be provided together",
          },
          { status: 400 },
        );
      }
      if (hasTokenId) {
        if (
          typeof s.transferTokenId !== "string" ||
          !validTokenIds.has(s.transferTokenId) ||
          typeof s.transferToOwnerId !== "string" ||
          s.transferToOwnerId.length === 0 ||
          !validAccountPattern.test(s.transferToOwnerId) ||
          forbiddenAccountIds.has(s.transferToOwnerId)
        ) {
          return Response.json(
            {
              error: "InvalidSimulationRequest",
              message: "Invalid transferTokenId or transferToOwnerId in schedule step",
            },
            { status: 400 },
          );
        }
      }

      schedule.push({
        gridPriceTier: s.gridPriceTier as TurnPolicyStep["gridPriceTier"],
        maintenanceReserveBps: s.maintenanceReserveBps,
        batAlphaZone: s.batAlphaZone as TurnPolicyStep["batAlphaZone"],
        batBetaZone: s.batBetaZone as TurnPolicyStep["batBetaZone"],
        transferTokenId: hasTokenId ? (s.transferTokenId as string) : null,
        transferToOwnerId: hasToOwner ? (s.transferToOwnerId as string) : null,
      });
    }

    const sim = simulateOrbitWeek(createInitialStationState(), schedule);
    return Response.json(
      {
        ...sim,
        nftFleetState: Object.values(sim.finalState.equipment),
        collapseAutopsy: buildCollapseAutopsy(sim.finalState),
      },
      { status: 200 },
    );
  }

  return Response.json(
    {
      error: "InvalidSimulationRequest",
      message: "Provide either presetId or a non-empty schedule array",
    },
    { status: 400 },
  );
}
