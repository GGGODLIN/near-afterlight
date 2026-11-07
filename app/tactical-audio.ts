export type TacticalCue =
  | "detent"
  | "latch"
  | "surge-daylight"
  | "surge-eclipse"
  | "blackout-alarm"
  | "survival-chord";

interface ToneSpec {
  type: OscillatorType;
  from: number;
  to: number;
  start: number;
  attack: number;
  peak: number;
  release: number;
  filter?: { type: BiquadFilterType; from: number; to: number; q: number };
}

interface NoiseSpec {
  start: number;
  duration: number;
  peak: number;
  filter: { type: BiquadFilterType; frequency: number; q: number };
}

const SILENCE = 0.0001;

function shapeGain(gain: GainNode, at: number, attack: number, peak: number, release: number): void {
  gain.gain.setValueAtTime(SILENCE, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(SILENCE, at + attack + release);
}

function playTone(ctx: BaseAudioContext, out: AudioNode, t0: number, spec: ToneSpec): void {
  const at = t0 + spec.start;
  const end = at + spec.attack + spec.release;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.from, at);
  osc.frequency.exponentialRampToValueAtTime(spec.to, end);
  shapeGain(gain, at, spec.attack, spec.peak, spec.release);

  if (spec.filter) {
    const filter = ctx.createBiquadFilter();
    filter.type = spec.filter.type;
    filter.Q.value = spec.filter.q;
    filter.frequency.setValueAtTime(spec.filter.from, at);
    filter.frequency.exponentialRampToValueAtTime(spec.filter.to, end);
    osc.connect(filter).connect(gain);
  } else {
    osc.connect(gain);
  }

  gain.connect(out);
  osc.start(at);
  osc.stop(end + 0.05);
}

function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playNoise(ctx: BaseAudioContext, out: AudioNode, t0: number, spec: NoiseSpec): void {
  const at = t0 + spec.start;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = whiteNoise(ctx);
  filter.type = spec.filter.type;
  filter.frequency.value = spec.filter.frequency;
  filter.Q.value = spec.filter.q;
  shapeGain(gain, at, 0.004, spec.peak, spec.duration);
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
  source.stop(at + spec.duration + 0.05);
}

function detent(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  playNoise(ctx, out, t0, { start: 0, duration: 0.03, peak: 0.3, filter: { type: "highpass", frequency: 2600, q: 0.7 } });
  playTone(ctx, out, t0, { type: "square", from: 1500, to: 900, start: 0, attack: 0.003, peak: 0.08, release: 0.04 });
  playTone(ctx, out, t0, { type: "sine", from: 170, to: 90, start: 0.004, attack: 0.004, peak: 0.22, release: 0.08 });
}

function latch(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  playTone(ctx, out, t0, { type: "sine", from: 240, to: 64, start: 0, attack: 0.01, peak: 0.34, release: 0.2 });
  playNoise(ctx, out, t0, { start: 0.05, duration: 0.04, peak: 0.18, filter: { type: "bandpass", frequency: 1900, q: 5 } });
  playTone(ctx, out, t0, { type: "triangle", from: 2350, to: 2200, start: 0.06, attack: 0.004, peak: 0.07, release: 0.42 });
}

function surgeDaylight(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  playTone(ctx, out, t0, {
    type: "sawtooth",
    from: 92,
    to: 360,
    start: 0,
    attack: 0.03,
    peak: 0.13,
    release: 0.34,
    filter: { type: "bandpass", from: 420, to: 2600, q: 3 },
  });
  playNoise(ctx, out, t0, { start: 0.02, duration: 0.26, peak: 0.07, filter: { type: "bandpass", frequency: 3200, q: 1.6 } });
  playTone(ctx, out, t0, { type: "sine", from: 880, to: 1320, start: 0.08, attack: 0.05, peak: 0.04, release: 0.4 });
}

function surgeEclipse(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  playTone(ctx, out, t0, {
    type: "sawtooth",
    from: 74,
    to: 150,
    start: 0,
    attack: 0.04,
    peak: 0.14,
    release: 0.42,
    filter: { type: "lowpass", from: 500, to: 1100, q: 2 },
  });
  playTone(ctx, out, t0, { type: "sine", from: 58, to: 46, start: 0, attack: 0.06, peak: 0.22, release: 0.55 });
  playNoise(ctx, out, t0, { start: 0.03, duration: 0.3, peak: 0.05, filter: { type: "lowpass", frequency: 900, q: 0.8 } });
}

function blackoutAlarm(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  const pulses = [110, 82, 110, 82];
  pulses.forEach((frequency, index) => {
    playTone(ctx, out, t0, {
      type: "square",
      from: frequency,
      to: frequency * 0.97,
      start: index * 0.26,
      attack: 0.02,
      peak: 0.12,
      release: 0.2,
      filter: { type: "lowpass", from: 760, to: 520, q: 1.2 },
    });
  });
  playTone(ctx, out, t0, { type: "sine", from: 44, to: 36, start: 0, attack: 0.08, peak: 0.24, release: 1.3 });
}

function survivalChord(ctx: BaseAudioContext, out: AudioNode, t0: number): void {
  const arpeggio = [523.25, 659.25, 783.99, 1046.5];
  arpeggio.forEach((frequency, index) => {
    playTone(ctx, out, t0, { type: "triangle", from: frequency, to: frequency, start: index * 0.09, attack: 0.02, peak: 0.09, release: 1.2 });
  });
  for (const frequency of [261.63, 329.63, 392]) {
    playTone(ctx, out, t0, { type: "sine", from: frequency, to: frequency, start: 0.05, attack: 0.3, peak: 0.045, release: 1.6 });
  }
}

const CUE_PLAYERS: Record<TacticalCue, (ctx: BaseAudioContext, out: AudioNode, t0: number) => void> = {
  detent,
  latch,
  "surge-daylight": surgeDaylight,
  "surge-eclipse": surgeEclipse,
  "blackout-alarm": blackoutAlarm,
  "survival-chord": survivalChord,
};

export function playTacticalCue(
  ctx: BaseAudioContext,
  out: AudioNode,
  cue: TacticalCue,
  delaySeconds = 0,
): void {
  CUE_PLAYERS[cue](ctx, out, ctx.currentTime + delaySeconds);
}
