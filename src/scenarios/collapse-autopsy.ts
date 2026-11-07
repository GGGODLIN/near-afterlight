import type {
  CollapseRootCause,
  StationState,
} from "../engine/afterlight-engine.ts";

export interface CollapseAutopsy {
  headline: string;
  failureTurn: number | null;
  rootCause: CollapseRootCause | null;
  remediationHint: string;
}

// Lives outside app/api so the route and the command deck share one autopsy text; Next.js route files may only export HTTP handlers.
export function buildCollapseAutopsy(finalState: Readonly<StationState>): CollapseAutopsy {
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
      "0% Skim maintenance starved equipment reserves until wear decayed effective capacity below the 50 kWh Eclipse load. Fix: Enable 20% Standard (2000 bps) or 40% Fortify (4000 bps) reserve retention.",
  };
}
