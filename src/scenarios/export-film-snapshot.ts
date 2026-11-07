import {
  listTrajectoryPresets,
  runTrajectoryPreset,
  type TrajectorySimulationResult,
} from "./station-trajectories.ts";

export interface AfterlightFilmSnapshot {
  project: string;
  tracks: readonly ["games", "nfts"];
  presets: Record<string, TrajectorySimulationResult>;
}

export function buildFilmSnapshot(): AfterlightFilmSnapshot {
  const presets: Record<string, TrajectorySimulationResult> = {};
  for (const descriptor of listTrajectoryPresets()) {
    presets[descriptor.id] = runTrajectoryPreset(descriptor.id);
  }
  return {
    project: "Afterlight",
    tracks: ["games", "nfts"],
    presets,
  };
}
