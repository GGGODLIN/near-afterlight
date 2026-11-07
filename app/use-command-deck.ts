import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  DEFAULT_OPERATOR_A,
  type StationAction,
  type StationState,
  type TurnAccountingReceipt,
} from "../src/engine/afterlight-engine.ts";
import type { AllowedDelegateMethod, GridPriceTierKey } from "../src/engine/constants.ts";
import type { TrajectoryPresetId } from "../src/scenarios/station-trajectories.ts";
import {
  commandStation,
  createDeck,
  fetchReplayRun,
  frameOf,
  handoverToOperatorB,
  isJudgeReport,
  lockReasonFor,
  REPLAY_STEP_MS,
  runExploitProbes,
  seekReplay,
  skyOf,
  startReplay,
  stepReplay,
  toggleReplay,
  type CommandOutcome,
  type DeckState,
  type JudgeRun,
  type PresetCard,
} from "./deck-session.ts";
import type { SkyMode } from "./station-stage.tsx";
import { playTacticalCue, type TacticalCue } from "./tactical-audio.ts";

const MASTER_VOLUME = 0.22;

type PlayCue = (cue: TacticalCue, delaySeconds?: number, force?: boolean) => void;

function useTacticalAudio(muted: boolean): PlayCue {
  const audioRef = useRef<{ ctx: AudioContext; master: GainNode } | null>(null);

  useEffect(
    () => () => {
      void audioRef.current?.ctx.close();
      audioRef.current = null;
    },
    [],
  );

  return useCallback(
    (cue, delaySeconds = 0, force = false) => {
      if (muted && !force) {
        return;
      }
      if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
        return;
      }
      if (!audioRef.current) {
        const ctx = new window.AudioContext();
        const master = ctx.createGain();
        master.gain.value = MASTER_VOLUME;
        master.connect(ctx.destination);
        audioRef.current = { ctx, master };
      }
      const { ctx, master } = audioRef.current;
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      playTacticalCue(ctx, master, cue, delaySeconds);
    },
    [muted],
  );
}

export interface CommandDeckActions {
  tier: (tier: GridPriceTierKey) => void;
  reserve: (bps: number) => void;
  route: (tokenId: string) => void;
  advance: () => void;
  handover: (tokenId: string) => void;
  exploit: (tokenId: string) => void;
  reset: () => void;
  preset: (card: PresetCard) => void;
  playToggle: () => void;
  seek: (turn: number) => void;
  toggleSound: () => void;
  toggleDrawer: () => void;
  runJudge: () => void;
}

export interface CommandDeckModel {
  deck: DeckState;
  state: StationState;
  receipt: TurnAccountingReceipt | null;
  sky: SkyMode;
  lockReason: string | null;
  muted: boolean;
  pendingPresetId: TrajectoryPresetId | null;
  drawerOpen: boolean;
  judge: JudgeRun;
  actions: CommandDeckActions;
}

export function useCommandDeck(): CommandDeckModel {
  const [deck, setDeck] = useState<DeckState>(createDeck);
  const [muted, setMuted] = useState(false);
  const [pendingPresetId, setPendingPresetId] = useState<TrajectoryPresetId | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [judge, setJudge] = useState<JudgeRun>({ status: "idle" });
  const presetRequestRef = useRef(0);
  const cue = useTacticalAudio(muted);

  const frame = frameOf(deck);
  const lockReason = lockReasonFor(deck);
  const controlsLocked = lockReason !== null;
  const isPlaying = deck.replay?.playing ?? false;

  const onReplayTick = useEffectEvent(() => {
    const replay = deck.replay;
    if (!replay || !replay.playing) {
      return;
    }
    const next = stepReplay(replay);
    setDeck({ ...deck, replay: next });
    if (next.playing) {
      cue("replay-tick");
      return;
    }
    const finalStatus = next.run.turnSnapshots.at(-1)?.stationStatus;
    cue(finalStatus === "SURVIVED" ? "survival-chord" : "blackout-alarm");
  });

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }
    const timer = window.setInterval(() => onReplayTick(), REPLAY_STEP_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const issue = (action: StationAction, methodName: AllowedDelegateMethod, label: string): CommandOutcome => {
    const outcome = commandStation(deck, action, methodName, label);
    setDeck(outcome.deck);
    return outcome;
  };

  const tier = (nextTier: GridPriceTierKey) => {
    if (controlsLocked || nextTier === deck.live.state.gridPriceTier) {
      return;
    }
    const outcome = issue(
      {
        kind: "SetPolicy",
        actorId: DEFAULT_OPERATOR_A,
        gridPriceTier: nextTier,
        maintenanceReserveBps: deck.live.state.maintenanceReserveBps,
      },
      "set_policy",
      `Grid price tier → ${nextTier}`,
    );
    cue(outcome.accepted ? "detent" : "access-denied");
  };

  const reserve = (bps: number) => {
    if (controlsLocked || bps === deck.live.state.maintenanceReserveBps) {
      return;
    }
    const outcome = issue(
      {
        kind: "SetPolicy",
        actorId: DEFAULT_OPERATOR_A,
        gridPriceTier: deck.live.state.gridPriceTier,
        maintenanceReserveBps: bps,
      },
      "set_policy",
      `Maintenance reserve → ${bps} bps`,
    );
    cue(outcome.accepted ? "detent" : "access-denied");
  };

  const route = (tokenId: string) => {
    const battery = deck.live.state.equipment[tokenId];
    if (controlsLocked || !battery) {
      return;
    }
    const targetZone = battery.zone === "SOLAR_ARRAY" ? "HABITAT_DOME" : "SOLAR_ARRAY";
    const outcome = issue(
      { kind: "RouteBattery", actorId: DEFAULT_OPERATOR_A, tokenId, targetZone },
      "route_battery",
      `Route ${tokenId} → ${targetZone}`,
    );
    cue(outcome.accepted ? "latch" : "access-denied");
  };

  const advance = () => {
    if (controlsLocked) {
      return;
    }
    const outcome = issue(
      { kind: "AdvanceTurn", actorId: DEFAULT_OPERATOR_A },
      "advance_turn",
      `Advance to turn ${deck.live.state.turn + 1}`,
    );
    if (!outcome.accepted) {
      cue("access-denied");
      return;
    }
    cue(outcome.receipt?.orbitalPhase === "ECLIPSE" ? "surge-eclipse" : "surge-daylight");
    const status = outcome.deck.live.state.stationStatus;
    if (status === "BLACKOUT") {
      cue("blackout-alarm", 0.25);
    } else if (status === "SURVIVED") {
      cue("survival-chord", 0.3);
    }
  };

  const handover = (tokenId: string) => {
    const outcome = handoverToOperatorB(deck, tokenId);
    if (!outcome) {
      return;
    }
    setDeck(outcome.deck);
    cue(outcome.accepted ? "handover-chime" : "access-denied");
  };

  const exploit = (tokenId: string) => {
    setDeck(runExploitProbes(deck, frame.state, tokenId));
    cue("access-denied");
  };

  const reset = () => {
    presetRequestRef.current += 1;
    setPendingPresetId(null);
    setDeck(createDeck());
    cue("detent");
  };

  const loadPreset = async (card: PresetCard) => {
    cue("detent");
    presetRequestRef.current += 1;
    const requestId = presetRequestRef.current;
    setPendingPresetId(card.id);
    const run = await fetchReplayRun(card);
    if (requestId !== presetRequestRef.current) {
      return;
    }
    setPendingPresetId(null);
    setDeck((current) => startReplay(current, run));
    cue("surge-daylight");
  };

  const playToggle = () => {
    if (!deck.replay) {
      return;
    }
    setDeck({ ...deck, replay: toggleReplay(deck.replay) });
    cue("detent");
  };

  const seek = (turn: number) => {
    if (!deck.replay) {
      return;
    }
    setDeck({ ...deck, replay: seekReplay(deck.replay, turn) });
    cue("replay-tick");
  };

  const toggleSound = () => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (!nextMuted) {
      cue("detent", 0, true);
    }
  };

  const runJudge = async () => {
    setJudge({ status: "running" });
    cue("detent");
    try {
      const response = await fetch("/api/verify");
      if (!response.ok) {
        setJudge({ status: "error", message: `GET /api/verify returned HTTP ${response.status}` });
        cue("access-denied");
        return;
      }
      const payload: unknown = await response.json();
      if (!isJudgeReport(payload)) {
        setJudge({ status: "error", message: "GET /api/verify returned an unexpected payload" });
        cue("access-denied");
        return;
      }
      setJudge({ status: "done", report: payload });
      cue(payload.verdict === "PASS" ? "survival-chord" : "access-denied");
    } catch (error: unknown) {
      setJudge({
        status: "error",
        message: error instanceof Error ? error.message : "GET /api/verify failed",
      });
      cue("access-denied");
    }
  };

  return {
    deck,
    state: frame.state,
    receipt: frame.receipt,
    sky: skyOf(frame),
    lockReason,
    muted,
    pendingPresetId,
    drawerOpen,
    judge,
    actions: {
      tier,
      reserve,
      route,
      advance,
      handover,
      exploit,
      reset,
      preset: (card) => void loadPreset(card),
      playToggle,
      seek,
      toggleSound,
      toggleDrawer: () => setDrawerOpen((open) => !open),
      runJudge: () => void runJudge(),
    },
  };
}
