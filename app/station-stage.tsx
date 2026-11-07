import type { CSSProperties, KeyboardEvent } from "react";
import {
  effectiveCapacityKwh,
  type EquipmentNftState,
  type StationState,
  type TurnAccountingReceipt,
} from "../src/engine/afterlight-engine.ts";

export type SkyMode = "daylight" | "eclipse" | "dawn";

interface StationStageProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
  sky: SkyMode;
  routingEnabled: boolean;
  onRouteBattery: (tokenId: string) => void;
}

type DockZone = EquipmentNftState["zone"];

// Low-discrepancy (R2) placement keeps the starfield identical on server and client without a seeded RNG.
const STARS = Array.from({ length: 150 }, (_, index) => {
  const n = index + 1;
  return {
    id: `star-${n}`,
    x: Math.round(((n * 0.7548776662) % 1) * 1200),
    y: Math.round(((n * 0.569840291) % 1) * 500),
    r: [0.6, 0.9, 1.2, 1.7][n % 4],
    delayMs: (n % 9) * 700,
    durationMs: 2800 + (n % 5) * 900,
  };
});

const PHOTONS = Array.from({ length: 14 }, (_, index) => ({
  id: `photon-${index}`,
  x: 40 + ((index * 53) % 300),
  y: 96 + ((index * 37) % 60),
  delayMs: (index % 7) * 260,
}));

const PANEL_COLUMNS = [50, 124, 198, 272];
const PANEL_ROWS = [146, 330];
const PANEL_WIDTH = 64;
const PANEL_HEIGHT = 124;

const TRUSS_PATH = Array.from({ length: 21 }, (_, index) => {
  const x = 40 + index * 16;
  return `${index === 0 ? "M" : "L"} ${x} ${index % 2 === 0 ? 292 : 308}`;
}).join(" ");

const WINDOW_SLOTS = Array.from({ length: 18 }, (_, index) => ({
  id: `window-${index}`,
  x: 904 + (index % 9) * 25,
  y: index < 9 ? 330 : 370,
  flickers: index % 5 === 2,
  delayMs: (index % 4) * 900,
}));

const DOCK_FRAMES: Record<DockZone, Array<{ x: number; y: number }>> = {
  SOLAR_ARRAY: [
    { x: 374, y: 296 },
    { x: 432, y: 296 },
  ],
  HABITAT_DOME: [
    { x: 774, y: 322 },
    { x: 832, y: 322 },
  ],
};

const BATTERY_SLOT: Record<string, number> = {
  "bat-alpha-1": 0,
  "bat-beta-2": 1,
};

const BATTERY_GLYPH: Record<string, string> = {
  "bat-alpha-1": "α",
  "bat-beta-2": "β",
};

const BATTERY_INNER_HEIGHT = 54;
const CORRIDOR_METER_WIDTH = 200;

function otherZone(zone: DockZone): DockZone {
  return zone === "SOLAR_ARRAY" ? "HABITAT_DOME" : "SOLAR_ARRAY";
}

function chargeTone(ratio: number): string {
  if (ratio >= 0.5) {
    return "is-charged";
  }
  return ratio >= 0.2 ? "is-low" : "is-depleted";
}

interface BatteryCapsuleProps {
  battery: EquipmentNftState;
  routingEnabled: boolean;
  discharging: boolean;
  onRouteBattery: (tokenId: string) => void;
}

function BatteryCapsule({ battery, routingEnabled, discharging, onRouteBattery }: BatteryCapsuleProps) {
  const frame = DOCK_FRAMES[battery.zone][BATTERY_SLOT[battery.tokenId] ?? 0];
  const effectiveCap = effectiveCapacityKwh(battery.maxCapacityKwh, battery.wearBps);
  const chargeRatio = battery.maxCapacityKwh > 0 ? battery.chargeKwh / battery.maxCapacityKwh : 0;
  const wornRatio = battery.maxCapacityKwh > 0 ? 1 - effectiveCap / battery.maxCapacityKwh : 0;
  const chargeHeight = Math.round(BATTERY_INNER_HEIGHT * chargeRatio);
  const wornHeight = Math.round(BATTERY_INNER_HEIGHT * wornRatio);
  const target = otherZone(battery.zone);
  const style: CSSProperties = { transform: `translate(${frame.x + 4}px, ${frame.y + 6}px)` };

  const handleKey = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onRouteBattery(battery.tokenId);
    }
  };

  const interactiveProps = routingEnabled
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `Route ${battery.name} to ${target}`,
        onClick: () => onRouteBattery(battery.tokenId),
        onKeyDown: handleKey,
      }
    : {};

  return (
    <g
      className={`battery ${chargeTone(chargeRatio)}${routingEnabled ? " is-routable" : ""}${discharging ? " is-discharging" : ""}`}
      style={style}
      {...interactiveProps}
    >
      <title>{`${battery.name} · ${battery.chargeKwh}/${effectiveCap} kWh · ${battery.zone}`}</title>
      <rect className="battery-halo" x={-6} y={-4} width={52} height={86} rx={14} />
      <rect className="battery-cap" x={13} y={0} width={14} height={7} rx={2} />
      <rect className="battery-body" x={0} y={5} width={40} height={64} rx={10} />
      {wornHeight > 0 ? (
        <rect className="battery-worn" x={4} y={10} width={32} height={wornHeight} rx={4} />
      ) : null}
      <rect
        className="battery-charge"
        x={4}
        y={10 + BATTERY_INNER_HEIGHT - chargeHeight}
        width={32}
        height={chargeHeight}
        rx={5}
      />
      <text className="battery-glyph" x={20} y={44}>
        {BATTERY_GLYPH[battery.tokenId] ?? "•"}
      </text>
      <text className="battery-readout" x={20} y={84}>
        {`${battery.chargeKwh} kWh`}
      </text>
    </g>
  );
}

interface SolarWingProps {
  lit: boolean;
  solarKwh: number | null;
  sky: SkyMode;
}

function solarCallout(sky: SkyMode, solarKwh: number | null): { text: string; tone: string } {
  if (sky === "eclipse") {
    return { text: `${solarKwh ?? 0} kWh · −150 °C`, tone: "is-ice" };
  }
  if (sky === "dawn") {
    return { text: "SUNRISE", tone: "is-gold" };
  }
  return solarKwh === null
    ? { text: "SUN LOCKED", tone: "is-gold" }
    : { text: `+${solarKwh} kWh`, tone: solarKwh > 0 ? "is-gold" : "is-idle" };
}

function SolarWing({ lit, solarKwh, sky }: SolarWingProps) {
  const callout = solarCallout(sky, solarKwh);
  return (
    <g className={`solar-wing${lit ? " is-generating" : ""}${sky === "eclipse" ? " is-frozen" : ""}`}>
      <path className="truss-lattice" d={TRUSS_PATH} />
      <rect className="truss-beam" x={38} y={290} width={326} height={20} rx={4} />
      {PANEL_ROWS.map((rowY) =>
        PANEL_COLUMNS.map((columnX) => (
          <g key={`panel-${columnX}-${rowY}`} className="solar-panel">
            <rect className="panel-mount" x={columnX + 28} y={rowY < 290 ? rowY + PANEL_HEIGHT : 310} width={8} height={rowY < 290 ? 290 - rowY - PANEL_HEIGHT : rowY - 310} />
            <rect className="panel-face" x={columnX} y={rowY} width={PANEL_WIDTH} height={PANEL_HEIGHT} rx={3} />
            <path
              className="panel-grid"
              d={`M ${columnX + 16} ${rowY} V ${rowY + PANEL_HEIGHT} M ${columnX + 32} ${rowY} V ${rowY + PANEL_HEIGHT} M ${columnX + 48} ${rowY} V ${rowY + PANEL_HEIGHT} M ${columnX} ${rowY + 31} H ${columnX + PANEL_WIDTH} M ${columnX} ${rowY + 62} H ${columnX + PANEL_WIDTH} M ${columnX} ${rowY + 93} H ${columnX + PANEL_WIDTH}`}
            />
            <rect className="panel-sheen" x={columnX} y={rowY} width={PANEL_WIDTH} height={PANEL_HEIGHT} rx={3} />
          </g>
        )),
      )}
      <path className="solar-flow" d="M 46 300 L 360 300" />
      <text className="stage-zone" x={206} y={126}>
        ZONE 1 · SOLAR_ARRAY
      </text>
      <text className="stage-sub" x={206} y={140}>
        Helios-IX wing · gen-solar-1
      </text>
      <text className={`stage-callout ${callout.tone}`} x={206} y={492}>
        {callout.text}
      </text>
    </g>
  );
}

interface CorridorProps {
  flowKwh: number;
  clampedKwh: number;
  capKwh: number;
}

function TransmissionCorridor({ flowKwh, clampedKwh, capKwh }: CorridorProps) {
  const ratio = capKwh > 0 ? Math.min(1, flowKwh / capKwh) : 0;
  const overflowWidth = capKwh > 0 ? Math.min(56, Math.round((clampedKwh / capKwh) * CORRIDOR_METER_WIDTH)) : 0;
  const clamped = clampedKwh > 0;
  const flowStyle = { "--flow-duration": `${Math.round(1500 - ratio * 1000)}ms` } as CSSProperties;

  return (
    <g className={`corridor${flowKwh > 0 ? " is-flowing" : ""}${clamped ? " is-clamped" : ""}`} style={flowStyle}>
      <text className="stage-zone" x={620} y={204}>
        ZONE 2 · TRANSMISSION_CORRIDOR
      </text>
      <rect className="meter-track" x={520} y={222} width={CORRIDOR_METER_WIDTH} height={10} rx={5} />
      <rect className="meter-fill" x={520} y={222} width={Math.round(CORRIDOR_METER_WIDTH * ratio)} height={10} rx={5} />
      {overflowWidth > 0 ? (
        <rect className="meter-overflow" x={720} y={222} width={overflowWidth} height={10} rx={3} />
      ) : null}
      <path className="meter-cap" d="M 720 216 V 238" />
      <text className="stage-meter" x={620} y={258}>
        {`FLOW ${flowKwh} / ${capKwh} kWh`}
      </text>
      <rect className="corridor-tube" x={500} y={284} width={240} height={32} rx={16} />
      <path className="corridor-core" d="M 514 300 L 726 300" />
      <path className="corridor-pulse" d="M 514 300 L 726 300" />
      <path className="corridor-pulse is-echo" d="M 514 300 L 726 300" />
      {clamped ? (
        <g className="corridor-warning">
          <path className="clamp-gate" d="M 734 280 V 320" />
          <text className="stage-callout is-alert" x={620} y={346}>
            {`⚠ CLAMPED ${clampedKwh} kWh`}
          </text>
        </g>
      ) : (
        <text className="stage-sub" x={620} y={344}>
          {`${capKwh} kWh hard transmission cap`}
        </text>
      )}
    </g>
  );
}

interface HabitatProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
}

function habitatCallout(blackout: boolean, receipt: TurnAccountingReceipt | null): string {
  if (blackout) {
    return "LIFE SUPPORT OFFLINE";
  }
  if (!receipt) {
    return "COLONY NOMINAL";
  }
  const deliveredKwh = receipt.habitatConsumedKwh + receipt.scrubberConsumedKwh;
  return `LOAD ${deliveredKwh}/${deliveredKwh + receipt.unmetLoadKwh} kWh`;
}

function HabitatDome({ state, receipt }: HabitatProps) {
  const blackout = state.stationStatus === "BLACKOUT";
  const scrubberStarved = receipt !== null && receipt.scrubberConsumedKwh === 0;
  const o2Ratio = Math.max(0, Math.min(1, state.o2Level / 100));
  const ringCircumference = Math.round(2 * Math.PI * 40);

  return (
    <g className={`habitat${blackout ? " is-blackout" : ""}${scrubberStarved ? " is-starved" : ""}`}>
      <text className="stage-zone" x={940} y={116}>
        ZONE 3 · HABITAT_DOME
      </text>
      <path className="dome-glass" d="M 760 300 A 180 158 0 0 1 1120 300 Z" />
      <path className="dome-glow" d="M 768 300 A 172 150 0 0 1 1112 300 Z" />
      <path className="dome-ribs" d="M 940 142 V 300 M 820 300 A 120 128 0 0 1 1060 300 M 868 300 A 72 96 0 0 1 1012 300" />
      <g className="dome-garden">
        <ellipse cx={836} cy={292} rx={40} ry={9} />
        <ellipse cx={908} cy={294} rx={30} ry={7} />
        <ellipse cx={964} cy={293} rx={22} ry={6} />
      </g>
      <g className="o2-scrubber">
        <circle className="o2-ring-track" cx={1036} cy={232} r={40} />
        <circle
          className="o2-ring"
          cx={1036}
          cy={232}
          r={40}
          strokeDasharray={ringCircumference}
          strokeDashoffset={Math.round(ringCircumference * (1 - o2Ratio))}
        />
        <circle className="turbine-housing" cx={1036} cy={232} r={28} />
        <g className="turbine-blades">
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <path key={`blade-${angle}`} d="M 1036 232 L 1032 208 Q 1036 204 1042 210 Z" transform={`rotate(${angle} 1036 232)`} />
          ))}
          <circle cx={1036} cy={232} r={5} />
        </g>
        <text className="stage-o2" x={1036} y={186}>
          {`O2 ${state.o2Level}%`}
        </text>
        <text className="stage-sub" x={1036} y={288}>
          AEGIS-IV SCRUBBER
        </text>
      </g>
      <rect className="habitat-ring" x={740} y={300} width={400} height={124} rx={26} />
      <path className="habitat-bus" d="M 740 300 H 1140" />
      <g className="habitat-windows">
        {WINDOW_SLOTS.map((slot) => (
          <rect
            key={slot.id}
            className={`window${slot.flickers ? " is-flicker" : ""}`}
            x={slot.x}
            y={slot.y}
            width={16}
            height={24}
            rx={4}
            style={{ animationDelay: `${slot.delayMs}ms` }}
          />
        ))}
      </g>
      <g className="emergency-beacons">
        <circle cx={940} cy={140} r={6} />
        <circle cx={748} cy={308} r={5} />
        <circle cx={1132} cy={308} r={5} />
      </g>
      <text className={`stage-callout ${blackout ? "is-alert" : "is-teal"}`} x={940} y={458}>
        {habitatCallout(blackout, receipt)}
      </text>
    </g>
  );
}

interface OrbitDialProps {
  turn: number;
  maxTurns: number;
  sky: SkyMode;
}

function OrbitDial({ turn, maxTurns, sky }: OrbitDialProps) {
  const onNightSide = sky === "eclipse";
  return (
    <g className="orbit-dial" aria-hidden="true">
      <path className="dial-day" d="M 1132 34 A 30 30 0 0 0 1132 94 Z" />
      <path className="dial-night" d="M 1132 34 A 30 30 0 0 1 1132 94 Z" />
      <circle className="dial-planet" cx={1132} cy={64} r={11} />
      <circle className="dial-station" cx={onNightSide ? 1162 : 1102} cy={64} r={5} />
      <text className="stage-sub" x={1132} y={116}>
        {`T${String(turn).padStart(2, "0")}/${maxTurns}`}
      </text>
    </g>
  );
}

export default function StationStage({ state, receipt, sky, routingEnabled, onRouteBattery }: StationStageProps) {
  const batteries = [state.equipment["bat-alpha-1"], state.equipment["bat-beta-2"]].filter(
    (battery): battery is EquipmentNftState => battery !== undefined,
  );
  // Before orbit 1 the wing already faces the sun; lighting it keeps the opening frame alive without inventing a generation figure.
  const generating = receipt ? receipt.solarGeneratedKwh > 0 : sky === "daylight";
  const habitatDischarge = receipt !== null && receipt.orbitalPhase === "ECLIPSE" && receipt.batteryDischargedKwh > 0;
  const status = state.stationStatus;

  return (
    <svg
      className="stage-svg"
      viewBox="0 0 1200 640"
      data-sky={sky}
      data-status={status}
      // role="group" rather than "img": an img role hides its children, which would bury the clickable batteries.
      role="group"
      aria-label={`Orbital station cross-section, turn ${state.turn} of ${state.maxTurns}, ${sky}, status ${status}`}
    >
      <defs>
        <radialGradient id="sky-daylight" cx="0.09" cy="0.12" r="1.1">
          <stop offset="0" stopColor="#4a3412" />
          <stop offset="0.28" stopColor="#14213f" />
          <stop offset="1" stopColor="#050812" />
        </radialGradient>
        <linearGradient id="sky-eclipse" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03020b" />
          <stop offset="0.6" stopColor="#0d0a2b" />
          <stop offset="1" stopColor="#1a1046" />
        </linearGradient>
        <radialGradient id="sky-dawn" cx="0.18" cy="0.9" r="1">
          <stop offset="0" stopColor="#ffb25b" />
          <stop offset="0.22" stopColor="#a8456b" />
          <stop offset="0.5" stopColor="#1b2350" />
          <stop offset="1" stopColor="#050812" />
        </radialGradient>
        <radialGradient id="sun-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset="0.35" stopColor="#ffd36b" />
          <stop offset="1" stopColor="#ff9f1c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="planet-body" cx="0.5" cy="0.05" r="0.6">
          <stop offset="0" stopColor="#1f6f8b" />
          <stop offset="0.45" stopColor="#0d2f4a" />
          <stop offset="1" stopColor="#040b16" />
        </radialGradient>
        <linearGradient id="panel-lit" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a3" />
          <stop offset="0.45" stopColor="#f7b32b" />
          <stop offset="1" stopColor="#9a5a08" />
        </linearGradient>
        <linearGradient id="panel-dark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b2a6e" />
          <stop offset="1" stopColor="#120f3a" />
        </linearGradient>
        <linearGradient id="dome-glass-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7ff5d6" stopOpacity="0.28" />
          <stop offset="1" stopColor="#0e3b4a" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="dome-warm" cx="0.5" cy="1" r="0.9">
          <stop offset="0" stopColor="#ffd27a" stopOpacity="0.85" />
          <stop offset="0.55" stopColor="#ff9f5a" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ff9f5a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="dome-red" cx="0.5" cy="0.15" r="0.95">
          <stop offset="0" stopColor="#ff2d55" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#7a0a22" stopOpacity="0.35" />
          <stop offset="1" stopColor="#2a0410" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="vignette-red" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.45" stopColor="#ff1f4b" stopOpacity="0" />
          <stop offset="1" stopColor="#ff1f4b" stopOpacity="0.5" />
        </radialGradient>
        <filter id="glow-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Straight strokes have a zero-height bounding box, so a bbox-relative filter region would clip them to nothing. */}
        <filter id="glow-line" filterUnits="userSpaceOnUse" x="440" y="180" width="360" height="200">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect className="sky-layer sky-daylight" width={1200} height={640} fill="url(#sky-daylight)" />
      <rect className="sky-layer sky-eclipse" width={1200} height={640} fill="url(#sky-eclipse)" />
      <rect className="sky-layer sky-dawn" width={1200} height={640} fill="url(#sky-dawn)" />

      <g className="starfield">
        {STARS.map((star) => (
          <circle
            key={star.id}
            cx={star.x}
            cy={star.y}
            r={star.r}
            style={{ animationDelay: `${star.delayMs}ms`, animationDuration: `${star.durationMs}ms` }}
          />
        ))}
      </g>

      <g className="sun">
        <circle className="sun-halo" cx={104} cy={70} r={120} fill="url(#sun-core)" />
        <circle className="sun-disc" cx={104} cy={70} r={30} />
      </g>
      <circle className="dawn-sun" cx={210} cy={560} r={90} fill="url(#sun-core)" />

      {generating ? (
        <g className="photon-rain">
          {PHOTONS.map((photon) => (
            <path
              key={photon.id}
              d={`M ${photon.x} ${photon.y} l 24 34`}
              style={{ animationDelay: `${photon.delayMs}ms` }}
            />
          ))}
        </g>
      ) : null}

      <g className="planet">
        <circle cx={600} cy={1540} r={1010} fill="url(#planet-body)" />
        <circle className="planet-rim" cx={600} cy={1540} r={1010} />
        <path className="planet-cloud" d="M 140 600 Q 380 566 620 582 T 1080 596" />
        <path className="planet-cloud" d="M 60 628 Q 300 604 560 616 T 1140 620" />
      </g>

      <OrbitDial turn={state.turn} maxTurns={state.maxTurns} sky={sky} />

      <SolarWing lit={generating || sky === "dawn"} solarKwh={receipt ? receipt.solarGeneratedKwh : null} sky={sky} />

      <g className="solar-hub">
        <rect className="hub-shell" x={358} y={204} width={144} height={194} rx={24} />
        <circle className="hub-core-glow" cx={430} cy={250} r={34} />
        <circle className="hub-core" cx={430} cy={250} r={20} />
        <circle className="hub-ring" cx={430} cy={250} r={27} />
        <text className="stage-sub" x={430} y={290}>
          GEN-SOLAR-1 HUB
        </text>
        {DOCK_FRAMES.SOLAR_ARRAY.map((dock) => (
          <rect key={`solar-dock-${dock.x}`} className="dock-frame" x={dock.x} y={dock.y} width={48} height={82} rx={12} />
        ))}
      </g>

      <TransmissionCorridor
        flowKwh={receipt ? receipt.corridorFlowKwh : 0}
        clampedKwh={receipt ? receipt.corridorClampedKwh : 0}
        capKwh={state.corridorCapKwh}
      />

      <HabitatDome state={state} receipt={receipt} />

      <g className="habitat-docks">
        {DOCK_FRAMES.HABITAT_DOME.map((dock) => (
          <rect
            key={`habitat-dock-${dock.x}`}
            className={`dock-frame${habitatDischarge ? " is-discharging" : ""}`}
            x={dock.x}
            y={dock.y}
            width={48}
            height={82}
            rx={12}
          />
        ))}
        <text className="stage-sub" x={829} y={318}>
          CRYOCELL DOCKS
        </text>
      </g>

      {batteries.map((battery) => (
        <BatteryCapsule
          key={battery.tokenId}
          battery={battery}
          routingEnabled={routingEnabled}
          discharging={habitatDischarge && battery.zone === "HABITAT_DOME"}
          onRouteBattery={onRouteBattery}
        />
      ))}

      <rect className="blackout-vignette" width={1200} height={640} fill="url(#vignette-red)" />
    </svg>
  );
}
