"use client";

import {
  DEFAULT_OPERATOR_A,
  DEFAULT_OPERATOR_B,
  effectiveCapacityKwh,
  sumAllStationCredits,
  type CollapseRootCause,
  type EquipmentNftState,
  type StationState,
  type TurnAccountingReceipt,
} from "../src/engine/afterlight-engine.ts";
import {
  COORDINATOR_CONTRACT_ID,
  CRITICAL_WEAR_THRESHOLD_BPS,
  GRID_PRICE_TIERS,
  type GridPriceTierKey,
} from "../src/engine/constants.ts";
import { buildCollapseAutopsy } from "../src/scenarios/collapse-autopsy.ts";
import type { TrajectoryPresetId } from "../src/scenarios/station-trajectories.ts";
import type { JudgeVerificationReport } from "../src/verifier/judge-audit-runner.ts";
import {
  ORBIT_CALENDAR,
  PRESET_CARDS,
  SESSION_RELAYER_ID,
  WASH_SYBIL_ID,
  type CardSlip,
  type ExploitProbe,
  type ExploitSlipData,
  type HandoverSlipData,
  type JudgeRun,
  type LiveSession,
  type PresetCard,
  type RelayEntry,
  type ReplayView,
} from "./deck-session.ts";
import StationStage from "./station-stage.tsx";
import { useCommandDeck } from "./use-command-deck.ts";

const PRICE_TIERS = (Object.keys(GRID_PRICE_TIERS) as GridPriceTierKey[]).map((tier) => ({
  tier,
  price: GRID_PRICE_TIERS[tier],
}));

const RESERVE_OPTIONS = [
  { bps: 0, label: "0% Skim" },
  { bps: 2000, label: "20% Standard" },
  { bps: 4000, label: "40% Fortify" },
] as const;

const ROUTABLE_BATTERIES = ["bat-alpha-1", "bat-beta-2"] as const;

const ACCOUNT_LABEL: Record<string, string> = {
  [DEFAULT_OPERATOR_A]: "Commander A",
  [DEFAULT_OPERATOR_B]: "Operator B",
  [SESSION_RELAYER_ID]: "Relayer",
  [WASH_SYBIL_ID]: "Wash sybil",
};

const ROOT_CAUSES: CollapseRootCause[] = [
  "CORRIDOR_BOTTLENECK_BLACKOUT",
  "SCRUBBER_SOLVENCY_COLLAPSE",
  "UNMAINTAINED_CAPACITY_DECAY",
];

const KIND_LABEL: Record<EquipmentNftState["kind"], string> = {
  SOLAR_GENERATOR: "Solar generator",
  STORAGE_BATTERY: "CryoCell storage",
  O2_SCRUBBER: "O2 scrubber",
};

function accountLabel(accountId: string): string {
  return ACCOUNT_LABEL[accountId] ?? accountId;
}

// Unmaintained runs drain their batteries and black out near 2400 bps, long before the 6000 bps decay limit,
// so the crack/spark warnings fire at 25% / 40% of that limit or players would never see them.
function wearLevel(wearBps: number): "ok" | "warn" | "critical" {
  if (wearBps >= CRITICAL_WEAR_THRESHOLD_BPS * 0.4) {
    return "critical";
  }
  return wearBps >= CRITICAL_WEAR_THRESHOLD_BPS * 0.25 ? "warn" : "ok";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

interface DeckHeaderProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
  replayTitle: string | null;
  muted: boolean;
  sessionNonce: number;
  onToggleSound: () => void;
}

function DeckHeader({ state, receipt, replayTitle, muted, sessionNonce, onToggleSound }: DeckHeaderProps) {
  const day = Math.max(1, Math.ceil(state.turn / 2));
  return (
    <header className="deck-header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="16" />
          <path d="M 6 26 Q 20 14 34 26" />
          <circle className="brand-dot" cx="27" cy="11" r="3" />
        </svg>
        <div>
          <h1>AFTERLIGHT</h1>
          <p>Orbital power-grid survival · NEAR games × nfts</p>
        </div>
      </div>
      <div className="mission-readout">
        <span className="readout-chip">
          TURN <strong>{pad2(state.turn)}</strong>/{state.maxTurns}
        </span>
        <span className="readout-chip">
          ORBITAL DAY <strong>{day}</strong>/{Math.ceil(state.maxTurns / 2)}
        </span>
        <span className={`readout-chip phase-${(receipt?.orbitalPhase ?? "standby").toLowerCase()}`}>
          {receipt?.orbitalPhase ?? "PRE-LAUNCH"}
        </span>
        <span className={`status-pill status-${state.stationStatus.toLowerCase()}`}>{state.stationStatus}</span>
      </div>
      <div className="header-actions">
        <span className="chain-capsule" title={`Session nonce ${sessionNonce} · relayer ${SESSION_RELAYER_ID}`}>
          <span className="capsule-dot" />
          Chain: Hidden · NEP-366 Gasless Session (0 Popups)
        </span>
        <span className={`mode-pill${replayTitle ? " is-replay" : ""}`}>
          {replayTitle ? `REPLAY · ${replayTitle}` : "LIVE COMMAND"}
        </span>
        <button
          type="button"
          className={`sound-toggle${muted ? " is-muted" : ""}`}
          aria-pressed={!muted}
          onClick={onToggleSound}
        >
          {muted ? "SOUND OFF" : "SOUND ON"}
        </button>
      </div>
    </header>
  );
}

interface PresetBarProps {
  activePresetId: TrajectoryPresetId | null;
  pendingPresetId: TrajectoryPresetId | null;
  onSelect: (card: PresetCard) => void;
}

function PresetBar({ activePresetId, pendingPresetId, onSelect }: PresetBarProps) {
  return (
    <nav className="preset-bar" aria-label="7-day fast-forward presets">
      <span className="preset-bar-label">7-DAY FAST-FORWARD</span>
      {PRESET_CARDS.map((card) => {
        const active = card.id === activePresetId;
        const pending = card.id === pendingPresetId;
        return (
          <button
            key={card.id}
            type="button"
            className={`preset-capsule${active ? " is-active" : ""}${pending ? " is-pending" : ""}${card.survived ? " is-survival" : " is-collapse"}`}
            aria-pressed={active}
            title={card.detail}
            onClick={() => onSelect(card)}
          >
            <span className="preset-name">{card.name}</span>
            <span className="preset-outcome">{pending ? "SIMULATING…" : card.outcomeLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}

interface StageBannerProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
}

function StageBanner({ state, receipt }: StageBannerProps) {
  if (state.stationStatus === "ACTIVE") {
    return null;
  }
  const autopsy = buildCollapseAutopsy(state);
  if (state.stationStatus === "SURVIVED") {
    return (
      <div className="stage-banner is-survived" role="status">
        <span className="banner-kicker">AFTERLIGHT · ORBIT WEEK COMPLETE</span>
        <strong className="banner-headline">{autopsy.headline}</strong>
        <p className="banner-hint">{autopsy.remediationHint}</p>
      </div>
    );
  }
  const scrubber = state.equipment["o2-scrubber-1"];
  const peakWear = Math.max(...Object.values(state.equipment).map((nft) => nft.wearBps));
  return (
    <div className="stage-banner is-blackout" role="alert">
      <span className="banner-kicker">BLACKOUT AUTOPSY · SINGLE ROOT CAUSE</span>
      <strong className="banner-headline">{autopsy.headline}</strong>
      <div className="banner-causes">
        {ROOT_CAUSES.map((cause) => (
          <span key={cause} className={`cause-chip${cause === autopsy.rootCause ? " is-root" : ""}`}>
            {cause}
          </span>
        ))}
      </div>
      <p className="banner-hint">{autopsy.remediationHint}</p>
      {receipt ? (
        <div className="banner-telemetry">
          <span>{`Unmet load ${receipt.unmetLoadKwh} kWh`}</span>
          <span>{`Corridor ${receipt.corridorFlowKwh}/${state.corridorCapKwh} kWh · clamped ${receipt.corridorClampedKwh}`}</span>
          <span>{`Scrubber reserve ${scrubber?.reserveCredits ?? 0} CR @ ${receipt.gridPricePerKwh} CR/kWh`}</span>
          <span>{`Peak wear ${peakWear} bps`}</span>
        </div>
      ) : null}
    </div>
  );
}

interface OrbitTimelineProps {
  state: StationState;
  replay: ReplayView | null;
  onSeek: (turn: number) => void;
  onPlay: () => void;
}

function slotStatus(turn: number, receipts: TurnAccountingReceipt[], reached: number): string {
  const receipt = receipts[turn - 1];
  if (!receipt) {
    const failed = receipts.some((entry) => entry.stationStatusAfter === "BLACKOUT");
    return failed ? "is-void" : "is-future";
  }
  if (turn > reached) {
    return "is-queued";
  }
  return receipt.stationStatusAfter === "BLACKOUT" ? "is-failed" : "is-done";
}

function playLabel(replay: ReplayView | null): string {
  if (!replay) {
    return "PICK A PRESET TO FAST-FORWARD";
  }
  if (replay.playing) {
    return "FAST-FORWARDING…";
  }
  return "PLAY 7-DAY FAST-FORWARD";
}

function OrbitTimeline({ state, replay, onSeek, onPlay }: OrbitTimelineProps) {
  const receipts = replay ? replay.run.turnReceipts : state.turnHistory;
  const reached = replay ? replay.cursor : state.turnHistory.length;
  return (
    <div className="orbit-timeline">
      <button type="button" className="play-button" disabled={!replay || replay.playing} onClick={onPlay}>
        <span className="play-glyph" aria-hidden="true" />
        {playLabel(replay)}
      </button>
      <ol className="turn-slots">
        {Array.from({ length: state.maxTurns }, (_, index) => index + 1).map((turn) => {
          const phase = ORBIT_CALENDAR[turn - 1] ?? "DAYLIGHT";
          const seekable = replay !== null && turn <= receipts.length;
          return (
            <li key={`turn-${turn}`}>
              <button
                type="button"
                className={`turn-slot ${slotStatus(turn, receipts, reached)}${turn === state.turn ? " is-current" : ""} phase-${phase.toLowerCase()}`}
                disabled={!seekable}
                aria-label={`Turn ${turn} ${phase}`}
                onClick={() => onSeek(turn)}
              >
                <span className="slot-phase" aria-hidden="true" />
                <span className="slot-number">{pad2(turn)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface TacticalConsoleProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
  locked: boolean;
  lockReason: string | null;
  onTier: (tier: GridPriceTierKey) => void;
  onReserve: (bps: number) => void;
  onRoute: (tokenId: string) => void;
  onAdvance: () => void;
  onReset: () => void;
}

interface PolicyControlsProps {
  state: StationState;
  locked: boolean;
  onTier: (tier: GridPriceTierKey) => void;
  onReserve: (bps: number) => void;
}

function PolicyControls({ state, locked, onTier, onReserve }: PolicyControlsProps) {
  return (
    <>
      <section className="console-block">
        <h2>
          <span className="block-key">A</span> Grid price tier
        </h2>
        <div className="segmented">
          {PRICE_TIERS.map(({ tier, price }) => (
            <button
              key={tier}
              type="button"
              className={`segment tier-${tier.toLowerCase()}${state.gridPriceTier === tier ? " is-on" : ""}`}
              aria-pressed={state.gridPriceTier === tier}
              disabled={locked}
              onClick={() => onTier(tier)}
            >
              <strong>{`${price} CR`}</strong>
              <span>{tier}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="console-block">
        <h2>
          <span className="block-key">B</span> Maintenance reserve
        </h2>
        <div className="segmented">
          {RESERVE_OPTIONS.map((option) => (
            <button
              key={option.bps}
              type="button"
              className={`segment reserve-${option.bps}${state.maintenanceReserveBps === option.bps ? " is-on" : ""}`}
              aria-pressed={state.maintenanceReserveBps === option.bps}
              disabled={locked}
              onClick={() => onReserve(option.bps)}
            >
              <strong>{option.label}</strong>
              <span>{`${option.bps} bps`}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

interface RoutingControlsProps {
  state: StationState;
  locked: boolean;
  onRoute: (tokenId: string) => void;
}

function RoutingControls({ state, locked, onRoute }: RoutingControlsProps) {
  const batteries = ROUTABLE_BATTERIES.map((tokenId) => state.equipment[tokenId]).filter(
    (battery): battery is EquipmentNftState => battery !== undefined,
  );
  return (
    <section className="console-block">
      <h2>
        <span className="block-key">C</span> Battery zone routing
      </h2>
      {batteries.map((battery) => {
        const inHabitat = battery.zone === "HABITAT_DOME";
        return (
          <button
            key={battery.tokenId}
            type="button"
            className={`route-switch${inHabitat ? " is-habitat" : " is-solar"}`}
            aria-pressed={inHabitat}
            aria-label={`Route ${battery.name} to ${inHabitat ? "SOLAR_ARRAY" : "HABITAT_DOME"}`}
            disabled={locked}
            onClick={() => onRoute(battery.tokenId)}
          >
            <span className="route-name">
              {battery.name}
              <em>{`${battery.chargeKwh} kWh`}</em>
            </span>
            <span className="route-track">
              <span className="route-end">SOLAR</span>
              <span className="route-knob" />
              <span className="route-end">HABITAT</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

interface TurnActionsProps {
  state: StationState;
  locked: boolean;
  lockReason: string | null;
  onAdvance: () => void;
  onReset: () => void;
}

function TurnActions({ state, locked, lockReason, onAdvance, onReset }: TurnActionsProps) {
  const nextTurn = state.turn + 1;
  const nextPhase = nextTurn <= state.maxTurns ? ORBIT_CALENDAR[nextTurn - 1] : undefined;
  return (
    <div className="console-actions">
      <button type="button" className="advance-button" disabled={locked} onClick={onAdvance}>
        <span>Advance 1 Orbital Turn</span>
        <small>{nextPhase ? `→ TURN ${pad2(nextTurn)} · ${nextPhase}` : "ORBIT WEEK COMPLETE"}</small>
      </button>
      <button type="button" className="reset-button" onClick={onReset}>
        Reset Station
      </button>
      {lockReason ? <p className="lock-note">{lockReason}</p> : null}
    </div>
  );
}

interface ReceiptRow {
  label: string;
  value: string;
  alert: boolean;
}

function receiptRows(receipt: TurnAccountingReceipt, capKwh: number): ReceiptRow[] {
  return [
    { label: "Solar generated", value: `${receipt.solarGeneratedKwh} kWh`, alert: false },
    {
      label: "Battery out / in",
      value: `${receipt.batteryDischargedKwh} / ${receipt.batteryChargedKwh} kWh`,
      alert: false,
    },
    {
      label: "Corridor flow",
      value: `${receipt.corridorFlowKwh}/${capKwh} kWh · clamp ${receipt.corridorClampedKwh}`,
      alert: receipt.corridorClampedKwh > 0,
    },
    { label: "Curtailed", value: `${receipt.curtailedKwh} kWh`, alert: false },
    { label: "Unmet load", value: `${receipt.unmetLoadKwh} kWh`, alert: receipt.unmetLoadKwh > 0 },
    {
      label: "Revenue split",
      value: `${receipt.grossRevenueCredits} CR → ${receipt.retainedToReserveCredits} reserve + ${receipt.ownerPayoutCredits} payout`,
      alert: false,
    },
    { label: "Repairs → treasury", value: `${receipt.repairSpentToTreasuryCredits} CR`, alert: false },
    { label: "Habitat O2", value: `${receipt.o2Before}% → ${receipt.o2After}%`, alert: receipt.o2After < receipt.o2Before },
  ];
}

interface ReceiptCardProps {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
}

function ReceiptCard({ state, receipt }: ReceiptCardProps) {
  if (!receipt) {
    return (
      <section className="console-block telemetry">
        <h2>Turn receipt · awaiting orbit 1</h2>
        <p className="telemetry-idle">{`Habitat O2 ${state.o2Level}% · advance a turn to stream engine receipts.`}</p>
      </section>
    );
  }
  return (
    <section className="console-block telemetry">
      <h2>{`Turn ${pad2(receipt.turn)} receipt · ${receipt.orbitalPhase}`}</h2>
      <dl>
        {receiptRows(receipt, state.corridorCapKwh).map((row) => (
          <div key={row.label} className={row.alert ? "is-alert" : undefined}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface LedgerCardProps {
  state: StationState;
}

function LedgerCard({ state }: LedgerCardProps) {
  const creditsTotal = sumAllStationCredits(state);
  return (
    <section className="console-block ledger">
      <h2>Closed-loop credit ledger</h2>
      <p className={`ledger-total${creditsTotal === state.initialTotalCredits ? " is-ok" : " is-alert"}`}>
        {`P1 · ${creditsTotal.toLocaleString("en-US")} / ${state.initialTotalCredits.toLocaleString("en-US")} CR conserved`}
      </p>
      <dl>
        {Object.entries(state.accountCredits).map(([accountId, credits]) => (
          <div key={accountId}>
            <dt>{accountLabel(accountId)}</dt>
            <dd>{`${credits} CR`}</dd>
          </div>
        ))}
        <div>
          <dt>Colonist pool</dt>
          <dd>{`${state.colonistDemandPoolCredits} CR`}</dd>
        </div>
        <div>
          <dt>Station treasury</dt>
          <dd>{`${state.stationTreasuryCredits} CR`}</dd>
        </div>
      </dl>
    </section>
  );
}

function TacticalConsole({
  state,
  receipt,
  locked,
  lockReason,
  onTier,
  onReserve,
  onRoute,
  onAdvance,
  onReset,
}: TacticalConsoleProps) {
  return (
    <aside className="console" aria-label="Tactical console">
      <PolicyControls state={state} locked={locked} onTier={onTier} onReserve={onReserve} />
      <RoutingControls state={state} locked={locked} onRoute={onRoute} />
      <TurnActions state={state} locked={locked} lockReason={lockReason} onAdvance={onAdvance} onReset={onReset} />
      <ReceiptCard state={state} receipt={receipt} />
      <LedgerCard state={state} />
    </aside>
  );
}

interface EquipmentGlyphProps {
  kind: EquipmentNftState["kind"];
}

function EquipmentGlyph({ kind }: EquipmentGlyphProps) {
  if (kind === "SOLAR_GENERATOR") {
    return (
      <svg className="glyph" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="12" cy="12" r="6" className="glyph-sun" />
        <path d="M 18 22 H 44 V 40 H 18 Z M 26.7 22 V 40 M 35.3 22 V 40 M 18 31 H 44" />
      </svg>
    );
  }
  if (kind === "STORAGE_BATTERY") {
    return (
      <svg className="glyph" viewBox="0 0 48 48" aria-hidden="true">
        <rect x="14" y="8" width="20" height="34" rx="6" />
        <rect x="20" y="4" width="8" height="4" rx="1" />
        <path className="glyph-bolt" d="M 26 14 L 19 27 H 25 L 22 36 L 30 22 H 24 Z" />
      </svg>
    );
  }
  return (
    <svg className="glyph" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="17" />
      <path className="glyph-fan" d="M 24 24 L 22 10 Q 24 8 27 11 Z M 24 24 L 36 31 Q 36 34 32 34 Z M 24 24 L 12 31 Q 10 29 12 26 Z" />
    </svg>
  );
}

function energyLine(nft: EquipmentNftState): string {
  const effectiveCap = effectiveCapacityKwh(nft.maxCapacityKwh, nft.wearBps);
  if (nft.kind === "STORAGE_BATTERY") {
    return `${nft.chargeKwh}/${effectiveCap} kWh · rated ${nft.maxCapacityKwh}`;
  }
  if (nft.kind === "SOLAR_GENERATOR") {
    return `${effectiveCap} kWh daylight output`;
  }
  return `${nft.maxCapacityKwh} kWh/turn rated load`;
}

function handoverBlocker(nft: EquipmentNftState, isLive: boolean, status: StationState["stationStatus"]): string | null {
  if (!isLive) {
    return "Replay snapshot — reset to command";
  }
  if (status === "BLACKOUT") {
    return "Ledger frozen by blackout";
  }
  if (nft.ownerId !== DEFAULT_OPERATOR_A) {
    return `Held by ${accountLabel(nft.ownerId)}`;
  }
  return null;
}

interface HandoverSlipProps {
  slip: HandoverSlipData;
}

function HandoverSlip({ slip }: HandoverSlipProps) {
  if (!slip.accepted) {
    return (
      <div className="slip is-denied">
        <strong>{`HANDOVER REJECTED · ${slip.rejection ?? "unknown"}`}</strong>
        <span>{`NEP-366 nonce ${slip.nonce} · 0 popups · 0 yocto deposit`}</span>
      </div>
    );
  }
  return (
    <div className="slip is-ok">
      <strong>HANDOVER SETTLED → Operator B</strong>
      <span>{`NEP-366 nonce ${slip.nonce} · 0 popups · 0 yocto deposit`}</span>
      <span>{`${slip.p3Holds ? "P3 preserved" : "P3 VIOLATED"} · wear ${slip.wearBps} bps · reserve ${slip.reserveCredits} CR · charge ${slip.chargeKwh} kWh`}</span>
    </div>
  );
}

type ProbeTone = "probe-ok" | "probe-bad" | "probe-skip";

// A probe the engine refused for another reason (e.g. TerminalBlackoutImmutable) never exercised P3, so it must not read as a pass.
function washProbeTone(wash: ExploitProbe): ProbeTone {
  if (!wash.engineAccepted) {
    return "probe-skip";
  }
  return wash.p3Holds ? "probe-ok" : "probe-bad";
}

function siphonProbeTone(siphon: ExploitProbe): ProbeTone {
  if (siphon.engineAccepted) {
    return "probe-bad";
  }
  return siphon.engineRejectionCode === "UnauthorizedNftTransfer" && siphon.p3Holds ? "probe-ok" : "probe-skip";
}

function washProbeLine(wash: ExploitProbe): string {
  if (!wash.engineAccepted) {
    return `Wash wear → sybil · not executed (engine ${wash.engineRejectionCode ?? wash.envelopeVerdict}) · P3 not exercised`;
  }
  const effect = `wear ${wash.wearBefore} → ${wash.wearAfter} bps · reserve ${wash.reserveBefore} → ${wash.reserveAfter} CR`;
  return `Wash wear → sybil · ${effect} · ${wash.p3Holds ? "P3 Non-Laundering Enforced" : "P3 VIOLATED"}`;
}

function siphonProbeLine(siphon: ExploitProbe): string {
  const verdict = siphon.engineAccepted
    ? "ACCEPTED"
    : `BLOCKED ${siphon.engineRejectionCode ?? siphon.envelopeVerdict}`;
  return `Unauthorized siphon ← ${accountLabel(siphon.attackerId)} · envelope ${siphon.envelopeVerdict} · predecessor ${siphon.effectivePredecessorId} · ${verdict}`;
}

interface ExploitSlipProps {
  slip: ExploitSlipData;
}

function ExploitSlip({ slip }: ExploitSlipProps) {
  return (
    <div className="slip is-intercept">
      <strong>{`EXPLOIT PROBES · TURN ${pad2(slip.turn)}`}</strong>
      <span className={washProbeTone(slip.wash)}>{washProbeLine(slip.wash)}</span>
      <span className={siphonProbeTone(slip.siphon)}>{siphonProbeLine(slip.siphon)}</span>
    </div>
  );
}

interface SlipViewProps {
  slip: CardSlip;
}

function SlipView({ slip }: SlipViewProps) {
  return slip.kind === "handover" ? <HandoverSlip slip={slip} /> : <ExploitSlip slip={slip} />;
}

interface EquipmentRackProps {
  state: StationState;
  slips: Record<string, CardSlip>;
  isLive: boolean;
  onHandover: (tokenId: string) => void;
  onExploit: (tokenId: string) => void;
}

function EquipmentRack({ state, slips, isLive, onHandover, onExploit }: EquipmentRackProps) {
  return (
    <section className="rack" aria-label="NEP-171 equipment rack">
      <header className="rack-header">
        <h2>NEP-171 equipment rack</h2>
        <p>Every unit is a dynamic NFT: ownership moves future revenue and locked reserves, never wear.</p>
      </header>
      <div className="rack-grid">
        {Object.values(state.equipment).map((nft) => {
          const level = wearLevel(nft.wearBps);
          const blocker = handoverBlocker(nft, isLive, state.stationStatus);
          const slip = slips[nft.tokenId];
          const wearPercent = Math.min(100, nft.wearBps / 100);
          const thresholdPercent = CRITICAL_WEAR_THRESHOLD_BPS / 100;
          return (
            <article key={nft.tokenId} className={`rack-card wear-${level}`}>
              <div className="card-top">
                <div className="card-glyph">
                  <EquipmentGlyph kind={nft.kind} />
                  {level !== "ok" ? <span className="card-crack" aria-hidden="true" /> : null}
                  {level === "critical" ? <span className="card-sparks" aria-hidden="true" /> : null}
                </div>
                <div className="card-title">
                  <span className="card-kind">{`${KIND_LABEL[nft.kind]} · NEP-171`}</span>
                  <h3>{nft.name}</h3>
                  <code>{nft.tokenId}</code>
                </div>
                <span className={`owner-badge${nft.ownerId === DEFAULT_OPERATOR_A ? " is-a" : " is-b"}`}>
                  {accountLabel(nft.ownerId)}
                </span>
              </div>
              <dl className="card-stats">
                <div>
                  <dt>Zone</dt>
                  <dd>{nft.zone}</dd>
                </div>
                <div>
                  <dt>Energy</dt>
                  <dd>{energyLine(nft)}</dd>
                </div>
                <div className="wear-row">
                  <dt>Wear</dt>
                  <dd>
                    <span className="wear-bar">
                      <span className="wear-fill" style={{ width: `${wearPercent}%` }} />
                      <span className="wear-threshold" style={{ left: `${thresholdPercent}%` }} />
                    </span>
                    {`${nft.wearBps} bps`}
                  </dd>
                </div>
                <div>
                  <dt>Reserve</dt>
                  <dd>{`${nft.reserveCredits} CR`}</dd>
                </div>
                <div>
                  <dt>Earned</dt>
                  <dd>{`${nft.cumulativeEarnedCredits} CR`}</dd>
                </div>
                <div>
                  <dt>Handovers</dt>
                  <dd>{nft.transferCount}</dd>
                </div>
              </dl>
              <div className="card-actions">
                <button
                  type="button"
                  className="card-button is-handover"
                  disabled={blocker !== null}
                  title={blocker ?? `Sign nft_transfer for ${nft.tokenId} with the session key`}
                  onClick={() => onHandover(nft.tokenId)}
                >
                  Handover NFT to Operator B
                </button>
                <button
                  type="button"
                  className="card-button is-exploit"
                  title="Dry-run against a copy of this state; the live game is untouched"
                  onClick={() => onExploit(nft.tokenId)}
                >
                  Simulate Exploit: Wash Wear / Unauthorized Siphon
                </button>
                {blocker ? <span className="card-note">{blocker}</span> : null}
              </div>
              {slip ? <SlipView slip={slip} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface InspectorDrawerProps {
  open: boolean;
  judge: JudgeRun;
  relayLog: RelayEntry[];
  live: LiveSession;
  state: StationState;
  onToggle: () => void;
  onRunJudge: () => void;
}

interface JudgeReportViewProps {
  report: JudgeVerificationReport;
}

// The verify route reports the server's absolute path; showing it would leak the host's directory layout to every viewer.
function repoRelativePath(absolutePath: string): string {
  const anchor = absolutePath.lastIndexOf("contracts/");
  return anchor === -1 ? absolutePath : absolutePath.slice(anchor);
}

function mark(passed: boolean): string {
  return passed ? "✓" : "✗";
}

function JudgeReportView({ report }: JudgeReportViewProps) {
  const rust = report.rustContractCheck;
  const pbt = report.pbtSuite;
  const witness = pbt.witnessCounts;
  const trajectories = report.trajectoryComparison;
  const primitiveCount = rust.requiredTokensFound.length + rust.missingTokens.length;
  const divergence = pbt.firstDivergence ? `turn ${pbt.firstDivergence.turnIndex}` : "none";
  return (
    <div className="judge-report">
      <p className={`judge-verdict is-${report.verdict.toLowerCase()}`}>
        <strong>{report.verdict}</strong>
        <span>{`${report.elapsedMs} ms · tracks ${report.tracks.join(" × ")}`}</span>
      </p>
      <dl>
        <div>
          <dt>Rust contract</dt>
          <dd>{`${mark(rust.passed)} ${repoRelativePath(rust.contractPath)} · ${rust.requiredTokensFound.length}/${primitiveCount} primitives · near-sdk =5.29.0 pinned ${mark(rust.cargoTomlPinsExact529)} · ${rust.goldenVectorsMatchedCount} golden vectors`}</dd>
        </div>
        <div>
          <dt>fast-check PBT</dt>
          <dd>{`${mark(pbt.passed)} ${pbt.numRuns} runs · seed ${pbt.seed} · ${pbt.invariantsVerified.join(" ")} · first divergence ${divergence}`}</dd>
        </div>
        <div>
          <dt>Witness floors</dt>
          <dd>
            {`${mark(pbt.witnessFloorsPassed)} 14-turn runs ${witness.completed14TurnRunsCount} · eclipse discharge ${witness.eclipseBatteryDischargeTurnsCount} · corridor clamps ${witness.corridorCapClampedTurnsCount} · worn handovers ${witness.degradedNftTransferPreservedCount} · starvation ${witness.maintenanceStarvationTurnsCount}`}
          </dd>
        </div>
        <div>
          <dt>NEP-366 relay</dt>
          <dd>{`${mark(report.nep366RelaySuite.passed)} ${report.nep366RelaySuite.casesVerified} envelope cases`}</dd>
        </div>
        <div>
          <dt>7-day trajectories</dt>
          <dd>{`${mark(trajectories.passed)} greedy T${trajectories.greedyCollapseTurn} ${trajectories.greedyRootCause ?? "—"} · corridor T${trajectories.corridorBlackoutTurn} ${trajectories.corridorRootCause ?? "—"} · balanced ${trajectories.balancedSurvivedTurns} turns ${trajectories.balancedFinalStatus}`}</dd>
        </div>
      </dl>
    </div>
  );
}

function relayOutcome(entry: RelayEntry): string {
  if (entry.envelopeVerdict !== "Valid") {
    return entry.envelopeVerdict;
  }
  return entry.engineAccepted ? "EXECUTED" : (entry.engineRejectionCode ?? "REJECTED");
}

interface JudgeColumnProps {
  judge: JudgeRun;
  onRunJudge: () => void;
}

function JudgeColumn({ judge, onRunJudge }: JudgeColumnProps) {
  return (
    <div className="inspector-column">
      <h3>Judge verification · GET /api/verify</h3>
      <button type="button" className="judge-button" disabled={judge.status === "running"} onClick={onRunJudge}>
        {judge.status === "running" ? "Running 200-run property suite…" : "Run Judge Verification"}
      </button>
      {judge.status === "done" ? <JudgeReportView report={judge.report} /> : null}
      {judge.status === "error" ? <p className="judge-error">{judge.message}</p> : null}
      {judge.status === "idle" ? (
        <p className="inspector-note">
          Runs the same audit as <code>npm run verify:judge</code>: Rust parity, P1–P4 fast-check, NEP-366 cases, 7-day trajectories.
        </p>
      ) : null}
    </div>
  );
}

function relayEntryClass(entry: RelayEntry): string {
  const executed = entry.engineAccepted && entry.envelopeVerdict === "Valid";
  return `relay-entry${executed ? " is-executed" : " is-blocked"}`;
}

function oracleSummary(entry: RelayEntry): string {
  return entry.oracleViolations.length === 0 ? "P1–P4 ✓" : entry.oracleViolations.join(" ");
}

interface SessionRelayColumnProps {
  relayLog: RelayEntry[];
  live: LiveSession;
}

function SessionRelayColumn({ relayLog, live }: SessionRelayColumnProps) {
  return (
    <div className="inspector-column">
      <h3>NEP-366 session relay</h3>
      <dl className="session-facts">
        <div>
          <dt>sender</dt>
          <dd>{DEFAULT_OPERATOR_A}</dd>
        </div>
        <div>
          <dt>relayer</dt>
          <dd>{SESSION_RELAYER_ID}</dd>
        </div>
        <div>
          <dt>receiver</dt>
          <dd>{COORDINATOR_CONTRACT_ID}</dd>
        </div>
        <div>
          <dt>deposit</dt>
          <dd>0 yoctoNEAR · method allowlist</dd>
        </div>
        <div>
          <dt>nonce / block</dt>
          <dd>{`${live.nonce} / ${live.blockHeight.toLocaleString("en-US")}`}</dd>
        </div>
      </dl>
      <ol className="relay-log">
        {relayLog.length === 0 ? <li className="relay-empty">No envelopes yet — every command you issue is relayed here.</li> : null}
        {relayLog.map((entry) => (
          <li key={entry.id} className={relayEntryClass(entry)}>
            <span className="relay-head">{`#${entry.id} ${entry.methodName} · nonce ${entry.nonce}`}</span>
            <span className="relay-label">{entry.label}</span>
            <span className="relay-verdict">
              {`envelope ${entry.envelopeVerdict} · predecessor ${accountLabel(entry.effectivePredecessorId)} · ${relayOutcome(entry)} · oracle ${oracleSummary(entry)}`}
            </span>
          </li>
        ))}
      </ol>
      <p className="inspector-note">
        Envelopes are verified in-browser by src/engine/nep366-session-guard.ts; signatures are deterministic simulation strings and no testnet transaction is broadcast.
      </p>
    </div>
  );
}

interface TokenStateColumnProps {
  state: StationState;
}

function TokenStateColumn({ state }: TokenStateColumnProps) {
  return (
    <div className="inspector-column">
      <h3>NEP-171 token state</h3>
      <table className="token-table">
        <thead>
          <tr>
            <th scope="col">token</th>
            <th scope="col">owner</th>
            <th scope="col">zone</th>
            <th scope="col">kWh</th>
            <th scope="col">wear</th>
            <th scope="col">reserve</th>
          </tr>
        </thead>
        <tbody>
          {Object.values(state.equipment).map((nft) => (
            <tr key={nft.tokenId}>
              <td>{nft.tokenId}</td>
              <td>{accountLabel(nft.ownerId)}</td>
              <td>{nft.zone === "SOLAR_ARRAY" ? "SOLAR" : "HABITAT"}</td>
              <td>{nft.chargeKwh}</td>
              <td>{nft.wearBps}</td>
              <td>{nft.reserveCredits}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="inspector-note">{`P1 ledger ${sumAllStationCredits(state)} / ${state.initialTotalCredits} CR · corridor cap ${state.corridorCapKwh} kWh · contract ${COORDINATOR_CONTRACT_ID}`}</p>
    </div>
  );
}

function InspectorDrawer({ open, judge, relayLog, live, state, onToggle, onRunJudge }: InspectorDrawerProps) {
  const verdict = judge.status === "done" ? judge.report.verdict : null;
  return (
    <section className={`inspector${open ? " is-open" : ""}`} aria-label="Judge and on-chain inspector">
      <button
        type="button"
        className="inspector-toggle"
        aria-expanded={open}
        aria-controls="inspector-panel"
        onClick={onToggle}
      >
        <span>{open ? "▴" : "▾"} Judge &amp; On-Chain Inspector</span>
        <span className="inspector-chips">
          <span className={verdict ? `verdict-${verdict.toLowerCase()}` : undefined}>
            {verdict ? `judge ${verdict}` : "judge not run"}
          </span>
        </span>
      </button>
      <div id="inspector-panel" className="inspector-panel" hidden={!open}>
        <JudgeColumn judge={judge} onRunJudge={onRunJudge} />
        <SessionRelayColumn relayLog={relayLog} live={live} />
        <TokenStateColumn state={state} />
      </div>
    </section>
  );
}

export default function CommandDeck() {
  const { deck, state, receipt, sky, lockReason, muted, pendingPresetId, drawerOpen, judge, actions } =
    useCommandDeck();
  const controlsLocked = lockReason !== null;
  const replayRun = deck.replay?.run ?? null;

  return (
    <div className="deck" data-status={state.stationStatus} data-sky={sky}>
      <DeckHeader
        state={state}
        receipt={receipt}
        replayTitle={replayRun ? replayRun.title : null}
        muted={muted}
        sessionNonce={deck.live.nonce}
        onToggleSound={actions.toggleSound}
      />
      <PresetBar
        activePresetId={replayRun ? replayRun.presetId : null}
        pendingPresetId={pendingPresetId}
        onSelect={actions.preset}
      />
      <div className="deck-main">
        <div className="deck-primary">
          <section className="stage-panel" aria-label="Orbital station cross-section">
            <div className="stage-frame">
              <StationStage
                state={state}
                receipt={receipt}
                sky={sky}
                routingEnabled={!controlsLocked}
                onRouteBattery={actions.route}
              />
              <StageBanner state={state} receipt={receipt} />
            </div>
            <OrbitTimeline state={state} replay={deck.replay} onSeek={actions.seek} onPlay={actions.play} />
          </section>
          <EquipmentRack
            state={state}
            slips={deck.cardSlips}
            isLive={deck.replay === null}
            onHandover={actions.handover}
            onExploit={actions.exploit}
          />
        </div>
        <TacticalConsole
          state={state}
          receipt={receipt}
          locked={controlsLocked}
          lockReason={lockReason}
          onTier={actions.tier}
          onReserve={actions.reserve}
          onRoute={actions.route}
          onAdvance={actions.advance}
          onReset={actions.reset}
        />
      </div>
      <InspectorDrawer
        open={drawerOpen}
        judge={judge}
        relayLog={deck.relayLog}
        live={deck.live}
        state={state}
        onToggle={actions.toggleDrawer}
        onRunJudge={actions.runJudge}
      />
    </div>
  );
}
