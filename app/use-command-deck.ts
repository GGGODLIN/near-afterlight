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
  restartReplay,
  runExploitProbes,
  seekReplay,
  skyOf,
  startReplay,
  stepReplay,
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
  play: () => void;
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
    if (outcome.accepted) {
      cue("detent");
    }
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
    if (outcome.accepted) {
      cue("detent");
    }
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
    if (outcome.accepted) {
      cue("latch");
    }
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
    if (outcome.accepted) {
      cue("detent");
    }
  };

  const exploit = (tokenId: string) => {
    setDeck(runExploitProbes(deck, frame.state, tokenId));
    cue("detent");
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
    if (!run) {
      return;
    }
    setDeck((current) => startReplay(current, run));
    cue("surge-daylight");
  };

  const play = () => {
    if (!deck.replay || deck.replay.playing) {
      return;
    }
    setDeck({ ...deck, replay: restartReplay(deck.replay) });
    cue("detent");
  };

  const seek = (turn: number) => {
    if (!deck.replay) {
      return;
    }
    setDeck({ ...deck, replay: seekReplay(deck.replay, turn) });
    cue("detent");
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
        return;
      }
      const payload: unknown = await response.json();
      if (!isJudgeReport(payload)) {
        setJudge({ status: "error", message: "GET /api/verify returned an unexpected payload" });
        return;
      }
      setJudge({ status: "done", report: payload });
      if (payload.verdict === "PASS") {
        cue("survival-chord");
      }
    } catch (error: unknown) {
      setJudge({
        status: "error",
        message: error instanceof Error ? error.message : "GET /api/verify failed",
      });
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
      play,
      seek,
      toggleSound,
      toggleDrawer: () => setDrawerOpen((open) => !open),
      runJudge: () => void runJudge(),
    },
  };
}
