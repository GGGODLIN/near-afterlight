import {
  createInitialStationState,
  DEFAULT_OPERATOR_A,
  DEFAULT_OPERATOR_B,
  type EquipmentNftState,
  type OrbitalPhase,
  type StationAction,
  type StationState,
  type TurnAccountingReceipt,
} from "../src/engine/afterlight-engine.ts";
import { evaluateAfterlightOracleStep } from "../src/engine/afterlight-oracle.ts";
import { COORDINATOR_CONTRACT_ID, type AllowedDelegateMethod } from "../src/engine/constants.ts";
import {
  buildDeterministicDelegateSignature,
  verifyAndExecuteNep366Delegate,
  type Nep366DelegateEnvelope,
  type Nep366EnvelopeRejection,
} from "../src/engine/nep366-session-guard.ts";
import {
  listTrajectoryPresets,
  runTrajectoryPreset,
  type TrajectoryPresetId,
  type TrajectorySimulationResult,
} from "../src/scenarios/station-trajectories.ts";
import type { JudgeVerificationReport } from "../src/verifier/judge-audit-runner.ts";
import type { SkyMode } from "./station-stage.tsx";

export const SESSION_RELAYER_ID = "relayer.afterlight.testnet";
export const WASH_SYBIL_ID = "wash-sybil.afterlight.testnet";
export const REPLAY_STEP_MS = 350;
const GENESIS_BLOCK_HEIGHT = 182_400_000;
const SESSION_BLOCK_WINDOW = 120;
const RELAY_LOG_LIMIT = 12;

export interface PresetCard {
  id: TrajectoryPresetId;
  name: string;
  detail: string;
  outcomeLabel: string;
  survived: boolean;
  clientRun: TrajectorySimulationResult;
}

function toPresetCard(descriptor: ReturnType<typeof listTrajectoryPresets>[number]): PresetCard {
  const clientRun = runTrajectoryPreset(descriptor.id);
  const finalState = clientRun.finalState;
  const lastReceipt = clientRun.turnReceipts.at(-1);
  const cut = descriptor.title.indexOf(" (");
  return {
    id: descriptor.id,
    name: cut === -1 ? descriptor.title : descriptor.title.slice(0, cut),
    detail: descriptor.subtitle,
    outcomeLabel:
      finalState.stationStatus === "SURVIVED"
        ? `${finalState.turn}/${finalState.maxTurns} SURVIVED`
        : `TURN ${finalState.turn} ${lastReceipt?.orbitalPhase ?? ""} BLACKOUT`,
    survived: finalState.stationStatus === "SURVIVED",
    clientRun,
  };
}

export const PRESET_CARDS: PresetCard[] = listTrajectoryPresets().map(toPresetCard);

// The Daylight/Eclipse calendar is read off the engine's own 14-turn survival run so the deck never re-implements the orbit schedule.
export const ORBIT_CALENDAR: OrbitalPhase[] = (
  PRESET_CARDS.find((card) => card.survived)?.clientRun.turnReceipts ?? []
).map((receipt) => receipt.orbitalPhase);

type RelayOrigin = "commander" | "exploit-probe";

export interface RelayEntry {
  id: number;
  label: string;
  origin: RelayOrigin;
  methodName: string;
  senderId: string;
  relayerSignerId: string;
  nonce: number;
  maxBlockHeight: number;
  envelopeVerdict: Nep366EnvelopeRejection;
  effectivePredecessorId: string;
  engineAccepted: boolean;
  engineRejectionCode: string | null;
  oracleViolations: Array<"P1" | "P2" | "P3" | "P4">;
}

export interface LiveSession {
  state: StationState;
  nonce: number;
  blockHeight: number;
}

export interface ReplayRun {
  presetId: TrajectoryPresetId;
  title: string;
  initialState: StationState;
  turnSnapshots: StationState[];
  turnReceipts: TurnAccountingReceipt[];
  source: "api" | "local-engine";
  matchesClientEngine: boolean;
}

export interface ReplayView {
  run: ReplayRun;
  cursor: number;
  playing: boolean;
}

export interface ExploitProbe {
  attackerId: string;
  envelopeVerdict: Nep366EnvelopeRejection;
  effectivePredecessorId: string;
  engineAccepted: boolean;
  engineRejectionCode: string | null;
  p3Holds: boolean;
  wearBefore: number;
  wearAfter: number;
  reserveBefore: number;
  reserveAfter: number;
}

export interface HandoverSlipData {
  kind: "handover";
  accepted: boolean;
  rejection: string | null;
  p3Holds: boolean;
  nonce: number;
  wearBps: number;
  reserveCredits: number;
  chargeKwh: number;
}

export interface ExploitSlipData {
  kind: "exploit";
  turn: number;
  wash: ExploitProbe;
  siphon: ExploitProbe;
}

export type CardSlip = HandoverSlipData | ExploitSlipData;

export interface DeckState {
  live: LiveSession;
  replay: ReplayView | null;
  relayLog: RelayEntry[];
  relaySeq: number;
  cardSlips: Record<string, CardSlip>;
}

export interface DeckFrame {
  state: StationState;
  receipt: TurnAccountingReceipt | null;
}

export type JudgeRun =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; report: JudgeVerificationReport }
  | { status: "error"; message: string };

export function createDeck(): DeckState {
  return {
    live: { state: createInitialStationState(), nonce: 0, blockHeight: GENESIS_BLOCK_HEIGHT },
    replay: null,
    relayLog: [],
    relaySeq: 0,
    cardSlips: {},
  };
}

function signEnvelope(
  senderId: string,
  methodName: AllowedDelegateMethod,
  nonce: number,
  blockHeight: number,
): Nep366DelegateEnvelope {
  const maxBlockHeight = blockHeight + SESSION_BLOCK_WINDOW;
  return {
    senderId,
    relayerSignerId: SESSION_RELAYER_ID,
    receiverId: COORDINATOR_CONTRACT_ID,
    methodName,
    nonce,
    lastNonce: nonce - 1,
    maxBlockHeight,
    currentBlockHeight: blockHeight,
    attachedDepositYocto: 0,
    signatureHex: buildDeterministicDelegateSignature(
      senderId,
      COORDINATOR_CONTRACT_ID,
      methodName,
      nonce,
      maxBlockHeight,
    ),
  };
}

interface SessionRelay {
  entry: RelayEntry;
  accepted: boolean;
  outcomeState: StationState;
  receipt: TurnAccountingReceipt | null;
  p3Holds: boolean;
}

function relayThroughSession(
  state: StationState,
  envelope: Nep366DelegateEnvelope,
  action: StationAction,
  meta: { id: number; label: string; origin: RelayOrigin },
): SessionRelay {
  const trace = verifyAndExecuteNep366Delegate(envelope, action, state);
  const executedAction: StationAction = {
    ...action,
    actorId: trace.executionVerdict.effectivePredecessorId,
  };
  const oracle = evaluateAfterlightOracleStep(
    state,
    executedAction,
    trace.outcome,
    state.initialTotalCredits,
  );
  return {
    entry: {
      ...meta,
      methodName: envelope.methodName,
      senderId: envelope.senderId,
      relayerSignerId: envelope.relayerSignerId,
      nonce: envelope.nonce,
      maxBlockHeight: envelope.maxBlockHeight,
      envelopeVerdict: trace.envelopeVerdict,
      effectivePredecessorId: trace.executionVerdict.effectivePredecessorId,
      engineAccepted: trace.executionVerdict.engineAccepted,
      engineRejectionCode: trace.executionVerdict.engineRejectionCode,
      oracleViolations: oracle.violatedInvariants,
    },
    accepted: trace.envelopeAccepted && trace.outcome.accepted,
    outcomeState: trace.outcome.state,
    receipt: trace.outcome.receipt,
    p3Holds: oracle.p3NftNonLaunderingAndSybilInvariance,
  };
}

export interface CommandOutcome {
  deck: DeckState;
  accepted: boolean;
  receipt: TurnAccountingReceipt | null;
}

interface RelayedCommand extends CommandOutcome {
  relay: SessionRelay;
}

function relayCommand(
  deck: DeckState,
  action: StationAction,
  methodName: AllowedDelegateMethod,
  label: string,
): RelayedCommand {
  const nonce = deck.live.nonce + 1;
  const blockHeight = deck.live.blockHeight + 1;
  const relay = relayThroughSession(
    deck.live.state,
    signEnvelope(action.actorId, methodName, nonce, blockHeight),
    action,
    { id: deck.relaySeq + 1, label, origin: "commander" },
  );
  return {
    deck: {
      ...deck,
      live: { state: relay.accepted ? relay.outcomeState : deck.live.state, nonce, blockHeight },
      relayLog: [relay.entry, ...deck.relayLog].slice(0, RELAY_LOG_LIMIT),
      relaySeq: deck.relaySeq + 1,
    },
    accepted: relay.accepted,
    receipt: relay.receipt,
    relay,
  };
}

export function commandStation(
  deck: DeckState,
  action: StationAction,
  methodName: AllowedDelegateMethod,
  label: string,
): CommandOutcome {
  const { deck: nextDeck, accepted, receipt } = relayCommand(deck, action, methodName, label);
  return { deck: nextDeck, accepted, receipt };
}

export function handoverToOperatorB(deck: DeckState, tokenId: string): CommandOutcome | null {
  const nft = deck.live.state.equipment[tokenId];
  if (deck.replay || !nft || nft.ownerId !== DEFAULT_OPERATOR_A) {
    return null;
  }
  const { deck: nextDeck, accepted, receipt, relay } = relayCommand(
    deck,
    { kind: "TransferEquipmentNft", actorId: nft.ownerId, tokenId, toOwnerId: DEFAULT_OPERATOR_B },
    "nft_transfer",
    `Handover ${tokenId} → Operator B`,
  );
  const after = nextDeck.live.state.equipment[tokenId] ?? nft;
  const slip: HandoverSlipData = {
    kind: "handover",
    accepted,
    rejection:
      relay.entry.engineRejectionCode ??
      (relay.entry.envelopeVerdict === "Valid" ? null : relay.entry.envelopeVerdict),
    p3Holds: relay.p3Holds,
    nonce: relay.entry.nonce,
    wearBps: after.wearBps,
    reserveCredits: after.reserveCredits,
    chargeKwh: after.chargeKwh,
  };
  return {
    deck: { ...nextDeck, cardSlips: { ...nextDeck.cardSlips, [tokenId]: slip } },
    accepted,
    receipt,
  };
}

function toExploitProbe(relay: SessionRelay, before: EquipmentNftState): ExploitProbe {
  const after = relay.outcomeState.equipment[before.tokenId] ?? before;
  return {
    attackerId: relay.entry.senderId,
    envelopeVerdict: relay.entry.envelopeVerdict,
    effectivePredecessorId: relay.entry.effectivePredecessorId,
    engineAccepted: relay.entry.engineAccepted,
    engineRejectionCode: relay.entry.engineRejectionCode,
    p3Holds: relay.p3Holds,
    wearBefore: before.wearBps,
    wearAfter: after.wearBps,
    reserveBefore: before.reserveCredits,
    reserveAfter: after.reserveCredits,
  };
}

// Probes run against a throwaway copy of the shown state, so the commander's live game and session nonce never move.
export function runExploitProbes(deck: DeckState, state: StationState, tokenId: string): DeckState {
  const target = state.equipment[tokenId];
  if (!target) {
    return deck;
  }
  const blockHeight = deck.live.blockHeight + 1;
  const wash = relayThroughSession(
    state,
    signEnvelope(target.ownerId, "nft_transfer", 1, blockHeight),
    { kind: "TransferEquipmentNft", actorId: target.ownerId, tokenId, toOwnerId: WASH_SYBIL_ID },
    { id: deck.relaySeq + 1, label: `Wash-wear probe · ${tokenId} → sybil`, origin: "exploit-probe" },
  );
  const siphon = relayThroughSession(
    state,
    signEnvelope(SESSION_RELAYER_ID, "nft_transfer", 1, blockHeight),
    { kind: "TransferEquipmentNft", actorId: target.ownerId, tokenId, toOwnerId: SESSION_RELAYER_ID },
    { id: deck.relaySeq + 2, label: `Siphon probe · relayer → ${tokenId}`, origin: "exploit-probe" },
  );
  return {
    ...deck,
    relayLog: [siphon.entry, wash.entry, ...deck.relayLog].slice(0, RELAY_LOG_LIMIT),
    relaySeq: deck.relaySeq + 2,
    cardSlips: {
      ...deck.cardSlips,
      [tokenId]: {
        kind: "exploit",
        turn: state.turn,
        wash: toExploitProbe(wash, target),
        siphon: toExploitProbe(siphon, target),
      },
    },
  };
}

export function startReplay(deck: DeckState, run: ReplayRun): DeckState {
  return { ...deck, replay: { run, cursor: 0, playing: true }, cardSlips: {} };
}

export function stepReplay(replay: ReplayView): ReplayView {
  const total = replay.run.turnReceipts.length;
  const cursor = Math.min(total, replay.cursor + 1);
  return { ...replay, cursor, playing: cursor < total };
}

export function toggleReplay(replay: ReplayView): ReplayView {
  const atEnd = replay.cursor >= replay.run.turnReceipts.length;
  return { ...replay, cursor: atEnd ? 0 : replay.cursor, playing: atEnd || !replay.playing };
}

export function seekReplay(replay: ReplayView, turn: number): ReplayView {
  return { ...replay, cursor: Math.min(turn, replay.run.turnReceipts.length), playing: false };
}

export function frameOf(deck: DeckState): DeckFrame {
  if (deck.replay) {
    const { run, cursor } = deck.replay;
    if (cursor === 0) {
      return { state: run.initialState, receipt: null };
    }
    return {
      state: run.turnSnapshots[cursor - 1] ?? run.initialState,
      receipt: run.turnReceipts[cursor - 1] ?? null,
    };
  }
  return { state: deck.live.state, receipt: deck.live.state.turnHistory.at(-1) ?? null };
}

export function skyOf(frame: DeckFrame): SkyMode {
  if (frame.state.stationStatus === "SURVIVED") {
    return "dawn";
  }
  const phase = frame.receipt?.orbitalPhase ?? ORBIT_CALENDAR[0] ?? "DAYLIGHT";
  return phase === "ECLIPSE" ? "eclipse" : "daylight";
}

export function lockReasonFor(deck: DeckState): string | null {
  if (deck.replay) {
    return "Replay mode — press Reset Station to take live command.";
  }
  if (deck.live.state.stationStatus === "BLACKOUT") {
    return "Station dark — the ledger is frozen. Reset Station to relaunch.";
  }
  if (deck.live.state.stationStatus === "SURVIVED") {
    return "Orbit week complete — Reset Station to fly again.";
  }
  return null;
}

function isSimulationPayload(
  value: unknown,
): value is Pick<TrajectorySimulationResult, "initialState" | "turnSnapshots" | "turnReceipts"> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.initialState === "object" &&
    payload.initialState !== null &&
    Array.isArray(payload.turnSnapshots) &&
    Array.isArray(payload.turnReceipts) &&
    payload.turnSnapshots.length === payload.turnReceipts.length
  );
}

export function isJudgeReport(value: unknown): value is JudgeVerificationReport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const report = value as Record<string, unknown>;
  return (
    (report.verdict === "PASS" || report.verdict === "FAIL") &&
    typeof report.rustContractCheck === "object" &&
    typeof report.pbtSuite === "object" &&
    typeof report.nep366RelaySuite === "object" &&
    typeof report.trajectoryComparison === "object"
  );
}

function localReplayRun(card: PresetCard): ReplayRun {
  return {
    presetId: card.id,
    title: card.name,
    initialState: card.clientRun.initialState,
    turnSnapshots: card.clientRun.turnSnapshots,
    turnReceipts: card.clientRun.turnReceipts,
    source: "local-engine",
    matchesClientEngine: true,
  };
}

export async function fetchReplayRun(card: PresetCard): Promise<ReplayRun> {
  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: card.id }),
    });
    if (!response.ok) {
      return localReplayRun(card);
    }
    const payload: unknown = await response.json();
    if (!isSimulationPayload(payload)) {
      return localReplayRun(card);
    }
    return {
      presetId: card.id,
      title: card.name,
      initialState: payload.initialState,
      turnSnapshots: payload.turnSnapshots,
      turnReceipts: payload.turnReceipts,
      source: "api",
      matchesClientEngine:
        JSON.stringify(payload.turnReceipts) === JSON.stringify(card.clientRun.turnReceipts),
    };
  } catch {
    // Network errors, non-OK responses, and malformed payloads fall back to the same engine in-browser so a preset never dead-ends; a request that never settles is not covered.
    return localReplayRun(card);
  }
}
