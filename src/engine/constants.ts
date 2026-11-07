export const AFTERLIGHT_TRACKS = ["games", "nfts"] as const;
export type AfterlightTrack = (typeof AFTERLIGHT_TRACKS)[number];

export const STATION_ZONES = [
  "SOLAR_ARRAY",
  "TRANSMISSION_CORRIDOR",
  "HABITAT_DOME",
] as const;
export type StationZone = (typeof STATION_ZONES)[number];

export const GRID_PRICE_TIERS = {
  SUBSIDIZED: 2,
  BALANCED: 4,
  SURGE: 8,
} as const;
export type GridPriceTierKey = keyof typeof GRID_PRICE_TIERS;

export const MAINTENANCE_RETENTION_TIERS = {
  SKIM_0: 0,
  STANDARD_20: 2000,
  FORTIFY_40: 4000,
} as const;
export type MaintenanceRetentionTierKey = keyof typeof MAINTENANCE_RETENTION_TIERS;

export const INITIAL_TOTAL_STATION_CREDITS = 10_000;
export const DEFAULT_CORRIDOR_CAP_KWH = 45;
export const HABITAT_BASE_LOAD_KWH = 20;
export const SCRUBBER_BASE_LOAD_KWH = 15;
export const REQUIRED_HABITAT_TOTAL_LOAD_KWH =
  HABITAT_BASE_LOAD_KWH + SCRUBBER_BASE_LOAD_KWH;
export const BASE_SOLAR_GENERATION_KWH = 100;
export const BATTERY_BASE_CAPACITY_KWH = 48;
export const WEAR_PER_ACTIVE_TURN_BPS = 600;
export const AUTO_REPAIR_WEAR_RECOVERY_BPS = 500;
export const AUTO_REPAIR_COST_CREDITS = 10;
export const CRITICAL_WEAR_THRESHOLD_BPS = 6000;
export const ORBIT_WEEK_TURNS = 14;
export const COORDINATOR_CONTRACT_ID = "station.afterlight.testnet";

export const ALLOWED_DELEGATE_METHODS = [
  "set_policy",
  "route_battery",
  "nft_transfer",
  "repair_equipment",
  "advance_turn",
] as const;
export type AllowedDelegateMethod = (typeof ALLOWED_DELEGATE_METHODS)[number];
