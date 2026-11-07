import {
  createInitialStationState,
  type CollapseRootCause,
  type StationState,
} from "../../../src/engine/afterlight-engine.ts";
import {
  listTrajectoryPresets,
  runTrajectoryPreset,
  simulateOrbitWeek,
  type TrajectoryPresetId,
  type TurnPolicyStep,
} from "../../../src/scenarios/station-trajectories.ts";

interface CollapseAutopsy {
  headline: string;
  failureTurn: number | null;
  rootCause: CollapseRootCause | null;
  remediationHint: string;
}

function buildCollapseAutopsy(finalState: Readonly<StationState>): CollapseAutopsy {
  if (finalState.stationStatus !== "BLACKOUT" || !finalState.collapseRootCause) {
    return {
      headline: "ALL 14 ORBITAL TURNS SURVIVED — LIFE SUPPORT NOMINAL",
      failureTurn: null,
      rootCause: null,
      remediationHint:
        "Habitat O2 maintained at 100% across all 7 Daylight/Eclipse cycles with closed-loop credit conservation.",
    };
  }

  if (finalState.collapseRootCause === "CORRIDOR_BOTTLENECK_BLACKOUT") {
    return {
      headline: `TURN ${finalState.turn} BLACKOUT — TRANSMISSION CORRIDOR SATURATED AT ${finalState.corridorCapKwh} kWh`,
      failureTurn: finalState.turn,
      rootCause: "CORRIDOR_BOTTLENECK_BLACKOUT",
      remediationHint:
        "Solar Array batteries had stored charge, but the 45 kWh corridor cap blocked the 50 kWh Eclipse load. Fix: Route CryoCell Battery Alpha into Habitat Dome before Eclipse.",
    };
  }

  if (finalState.collapseRootCause === "SCRUBBER_SOLVENCY_COLLAPSE") {
    return {
      headline: `TURN ${finalState.turn} BLACKOUT — O2 SCRUBBER BANKRUPTED BY SURGE ELECTRICITY TARIFF`,
      failureTurn: finalState.turn,
      rootCause: "SCRUBBER_SOLVENCY_COLLAPSE",
      remediationHint:
        "8 CR/kWh SURGE tariff exceeded Aegis-IV O2 Scrubber's 60 CR/turn colonist fee. Fix: Switch Grid Price Tier to BALANCED (4 CR/kWh) or SUBSIDIZED (2 CR/kWh).",
    };
  }

  return {
    headline: `TURN ${finalState.turn} BLACKOUT — UNMAINTAINED EQUIPMENT WEAR EXCEEDED CRITICAL THRESHOLD`,
    failureTurn: finalState.turn,
    rootCause: "UNMAINTAINED_CAPACITY_DECAY",
    remediationHint:
      "0% Skim maintenance starved equipment reserves until wear exceeded 6000 bps. Fix: Enable 20% Standard (2000 bps) or 40% Fortify (4000 bps) reserve retention.",
  };
}

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

  if (typeof body.presetId === "string") {
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

  if (Array.isArray(body.schedule) && body.schedule.length > 0) {
    const validTiers = new Set(["SUBSIDIZED", "BALANCED", "SURGE"]);
    const validZones = new Set(["SOLAR_ARRAY", "HABITAT_DOME"]);
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
      schedule.push({
        gridPriceTier: s.gridPriceTier as TurnPolicyStep["gridPriceTier"],
        maintenanceReserveBps: s.maintenanceReserveBps,
        batAlphaZone: s.batAlphaZone as TurnPolicyStep["batAlphaZone"],
        batBetaZone: s.batBetaZone as TurnPolicyStep["batBetaZone"],
        transferTokenId:
          typeof s.transferTokenId === "string" ? s.transferTokenId : null,
        transferToOwnerId:
          typeof s.transferToOwnerId === "string" ? s.transferToOwnerId : null,
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
