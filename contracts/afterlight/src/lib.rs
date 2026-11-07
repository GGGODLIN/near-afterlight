use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};
use std::collections::BTreeMap;

const INITIAL_TOTAL_STATION_CREDITS: u128 = 10_000;
const DEFAULT_CORRIDOR_CAP_KWH: u64 = 45;
const HABITAT_BASE_LOAD_KWH: u64 = 20;
const SCRUBBER_BASE_LOAD_KWH: u64 = 15;
const BASE_SOLAR_GENERATION_KWH: u64 = 100;
const BATTERY_BASE_CAPACITY_KWH: u64 = 48;
const WEAR_PER_ACTIVE_TURN_BPS: u64 = 600;
const AUTO_REPAIR_WEAR_RECOVERY_BPS: u64 = 500;
const AUTO_REPAIR_COST_CREDITS: u128 = 10;
const CRITICAL_WEAR_THRESHOLD_BPS: u64 = 6_000;
const ORBIT_WEEK_TURNS: u64 = 14;

#[derive(BorshStorageKey)]
#[near]
pub enum StorageKey {
    EquipmentByToken,
    CreditsByAccount,
    DelegateNonces,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentHandoverRecord {
    pub turn: u64,
    pub from_owner_id: String,
    pub to_owner_id: String,
    pub preserved_wear_bps: u64,
    pub preserved_reserve_credits: u128,
    pub preserved_charge_kwh: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentNft {
    pub token_id: String,
    pub name: String,
    pub kind: String,
    pub owner_id: String,
    pub zone: String,
    pub charge_kwh: u64,
    pub max_capacity_kwh: u64,
    pub wear_bps: u64,
    pub reserve_credits: u128,
    pub cumulative_earned_credits: u128,
    pub handover_history: Vec<EquipmentHandoverRecord>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PureStationState {
    pub turn: u64,
    pub max_turns: u64,
    pub station_status: String,
    pub collapse_root_cause: Option<String>,
    pub corridor_cap_kwh: u64,
    pub o2_level: u64,
    pub grid_price_tier: String,
    pub grid_price_per_kwh: u128,
    pub maintenance_reserve_bps: u64,
    pub colonist_demand_pool_credits: u128,
    pub station_treasury_credits: u128,
    pub account_credits: BTreeMap<String, u128>,
    pub equipment: BTreeMap<String, EquipmentNft>,
}

pub fn effective_capacity_kwh(max_capacity_kwh: u64, wear_bps: u64) -> u64 {
    let clamped_wear = wear_bps.min(10_000);
    (max_capacity_kwh * (10_000 - clamped_wear)) / 10_000
}

pub fn grid_price_for_tier(tier: &str) -> Option<u128> {
    match tier {
        "SUBSIDIZED" => Some(2),
        "BALANCED" => Some(4),
        "SURGE" => Some(8),
        _ => None,
    }
}

pub fn create_initial_pure_state(corridor_cap_kwh: u64) -> PureStationState {
    let op_a = "commander-a.afterlight.testnet".to_string();
    let op_b = "operator-b.afterlight.testnet".to_string();

    let mut account_credits = BTreeMap::new();
    account_credits.insert(op_a.clone(), 1_200);
    account_credits.insert(op_b.clone(), 1_200);

    let mut equipment = BTreeMap::new();
    equipment.insert(
        "gen-solar-1".to_string(),
        EquipmentNft {
            token_id: "gen-solar-1".to_string(),
            name: "Helios-IX Solar Array".to_string(),
            kind: "SOLAR_GENERATOR".to_string(),
            owner_id: op_a.clone(),
            zone: "SOLAR_ARRAY".to_string(),
            charge_kwh: 0,
            max_capacity_kwh: BASE_SOLAR_GENERATION_KWH,
            wear_bps: 0,
            reserve_credits: 200,
            cumulative_earned_credits: 0,
            handover_history: Vec::new(),
        },
    );
    equipment.insert(
        "bat-alpha-1".to_string(),
        EquipmentNft {
            token_id: "bat-alpha-1".to_string(),
            name: "CryoCell Battery Alpha".to_string(),
            kind: "STORAGE_BATTERY".to_string(),
            owner_id: op_a,
            zone: "HABITAT_DOME".to_string(),
            charge_kwh: BATTERY_BASE_CAPACITY_KWH,
            max_capacity_kwh: BATTERY_BASE_CAPACITY_KWH,
            wear_bps: 0,
            reserve_credits: 200,
            cumulative_earned_credits: 0,
            handover_history: Vec::new(),
        },
    );
    equipment.insert(
        "bat-beta-2".to_string(),
        EquipmentNft {
            token_id: "bat-beta-2".to_string(),
            name: "CryoCell Battery Beta".to_string(),
            kind: "STORAGE_BATTERY".to_string(),
            owner_id: op_b.clone(),
            zone: "SOLAR_ARRAY".to_string(),
            charge_kwh: BATTERY_BASE_CAPACITY_KWH,
            max_capacity_kwh: BATTERY_BASE_CAPACITY_KWH,
            wear_bps: 0,
            reserve_credits: 200,
            cumulative_earned_credits: 0,
            handover_history: Vec::new(),
        },
    );
    equipment.insert(
        "o2-scrubber-1".to_string(),
        EquipmentNft {
            token_id: "o2-scrubber-1".to_string(),
            name: "Aegis-IV O2 Scrubber".to_string(),
            kind: "O2_SCRUBBER".to_string(),
            owner_id: op_b,
            zone: "HABITAT_DOME".to_string(),
            charge_kwh: 0,
            max_capacity_kwh: SCRUBBER_BASE_LOAD_KWH,
            wear_bps: 0,
            reserve_credits: 200,
            cumulative_earned_credits: 0,
            handover_history: Vec::new(),
        },
    );

    PureStationState {
        turn: 0,
        max_turns: ORBIT_WEEK_TURNS,
        station_status: "ACTIVE".to_string(),
        collapse_root_cause: None,
        corridor_cap_kwh,
        o2_level: 100,
        grid_price_tier: "BALANCED".to_string(),
        grid_price_per_kwh: 4,
        maintenance_reserve_bps: 2_000,
        colonist_demand_pool_credits: 5_000,
        station_treasury_credits: 1_800,
        account_credits,
        equipment,
    }
}

pub fn sum_pure_station_credits(state: &PureStationState) -> u128 {
    let acct_sum: u128 = state.account_credits.values().copied().sum();
    let res_sum: u128 = state.equipment.values().map(|e| e.reserve_credits).sum();
    acct_sum + res_sum + state.colonist_demand_pool_credits + state.station_treasury_credits
}

pub fn step_pure_turn(state: &mut PureStationState) -> Result<(), &'static str> {
    if state.station_status == "BLACKOUT" {
        return Err("TerminalBlackoutImmutable");
    }
    if state.turn >= state.max_turns || state.station_status == "SURVIVED" {
        return Err("OrbitScheduleCompleted");
    }

    let turn = state.turn + 1;
    state.turn = turn;
    let is_daylight = turn % 2 == 1;

    let gen_wear = state.equipment.get("gen-solar-1").unwrap().wear_bps;
    let gen_max = state.equipment.get("gen-solar-1").unwrap().max_capacity_kwh;
    let solar_generated_kwh = if is_daylight {
        effective_capacity_kwh(gen_max, gen_wear)
    } else {
        0
    };

    let colonist_o2_fee = state.colonist_demand_pool_credits.min(60);
    state.colonist_demand_pool_credits -= colonist_o2_fee;
    {
        let scrubber = state.equipment.get_mut("o2-scrubber-1").unwrap();
        scrubber.reserve_credits += colonist_o2_fee;
        scrubber.cumulative_earned_credits += colonist_o2_fee;
    }

    let scrubber_power_bill = (SCRUBBER_BASE_LOAD_KWH as u128) * state.grid_price_per_kwh;
    let scrubber_solvent =
        state.equipment.get("o2-scrubber-1").unwrap().reserve_credits >= scrubber_power_bill;
    let effective_scrubber_demand_kwh = if scrubber_solvent {
        SCRUBBER_BASE_LOAD_KWH
    } else {
        0
    };

    let habitat_required_kwh = if is_daylight {
        HABITAT_BASE_LOAD_KWH
    } else {
        HABITAT_BASE_LOAD_KWH + 15
    };
    let total_required_load_kwh = habitat_required_kwh + SCRUBBER_BASE_LOAD_KWH;
    let solvent_target_load_kwh = habitat_required_kwh + effective_scrubber_demand_kwh;

    let desired_solar_to_habitat = solar_generated_kwh.min(solvent_target_load_kwh);
    let solar_to_habitat_via_corridor = desired_solar_to_habitat.min(state.corridor_cap_kwh);
    let mut corridor_clamped_kwh = desired_solar_to_habitat - solar_to_habitat_via_corridor;

    let mut remaining_habitat_need = solvent_target_load_kwh - solar_to_habitat_via_corridor;
    let mut remaining_corridor_cap = state.corridor_cap_kwh - solar_to_habitat_via_corridor;
    let mut remaining_solar = solar_generated_kwh - solar_to_habitat_via_corridor;

    let bat_ids = ["bat-alpha-1", "bat-beta-2"];

    for id in bat_ids {
        let bat = state.equipment.get_mut(id).unwrap();
        if bat.zone == "HABITAT_DOME" && remaining_habitat_need > 0 {
            let discharge = bat.charge_kwh.min(remaining_habitat_need);
            bat.charge_kwh -= discharge;
            remaining_habitat_need -= discharge;
        }
    }

    for id in bat_ids {
        let bat = state.equipment.get_mut(id).unwrap();
        if bat.zone == "SOLAR_ARRAY" && remaining_habitat_need > 0 {
            let available = bat.charge_kwh.min(remaining_habitat_need);
            let transmitted = available.min(remaining_corridor_cap);
            corridor_clamped_kwh += available - transmitted;
            bat.charge_kwh -= transmitted;
            remaining_habitat_need -= transmitted;
            remaining_corridor_cap -= transmitted;
        }
    }

    let delivered_to_habitat_kwh = solvent_target_load_kwh - remaining_habitat_need;
    let scrubber_consumed_kwh = delivered_to_habitat_kwh.min(effective_scrubber_demand_kwh);
    let habitat_consumed_kwh = delivered_to_habitat_kwh - scrubber_consumed_kwh;
    let unmet_load_kwh = total_required_load_kwh - delivered_to_habitat_kwh;

    for id in bat_ids {
        let bat = state.equipment.get_mut(id).unwrap();
        if bat.zone == "SOLAR_ARRAY" && remaining_solar > 0 {
            let eff_cap = effective_capacity_kwh(bat.max_capacity_kwh, bat.wear_bps);
            let room = eff_cap.saturating_sub(bat.charge_kwh);
            let charge = remaining_solar.min(room);
            bat.charge_kwh += charge;
            remaining_solar -= charge;
        }
    }

    for id in bat_ids {
        let bat = state.equipment.get_mut(id).unwrap();
        if bat.zone == "HABITAT_DOME" && remaining_solar > 0 {
            let eff_cap = effective_capacity_kwh(bat.max_capacity_kwh, bat.wear_bps);
            let room = eff_cap.saturating_sub(bat.charge_kwh);
            let desired_charge = remaining_solar.min(room);
            let transmitted_charge = desired_charge.min(remaining_corridor_cap);
            corridor_clamped_kwh += desired_charge - transmitted_charge;
            bat.charge_kwh += transmitted_charge;
            remaining_solar -= transmitted_charge;
            remaining_corridor_cap -= transmitted_charge;
        }
    }

    let scrubber_actual_bill = (scrubber_consumed_kwh as u128) * state.grid_price_per_kwh;
    state.equipment.get_mut("o2-scrubber-1").unwrap().reserve_credits -= scrubber_actual_bill;

    let habitat_requested_bill = (habitat_consumed_kwh as u128) * state.grid_price_per_kwh;
    let habitat_actual_bill = state.colonist_demand_pool_credits.min(habitat_requested_bill);
    state.colonist_demand_pool_credits -= habitat_actual_bill;

    let gross_revenue = scrubber_actual_bill + habitat_actual_bill;
    let retained_to_reserve = (gross_revenue * (state.maintenance_reserve_bps as u128)) / 10_000;
    let owner_payout = gross_revenue - retained_to_reserve;

    let supplier_ids = ["gen-solar-1", "bat-alpha-1", "bat-beta-2"];
    let per_unit_reserve = retained_to_reserve / 3;
    let reserve_rem = retained_to_reserve - per_unit_reserve * 3;
    let reserves = [per_unit_reserve + reserve_rem, per_unit_reserve, per_unit_reserve];

    let per_unit_payout = owner_payout / 3;
    let payout_rem = owner_payout - per_unit_payout * 3;
    let payouts = [per_unit_payout + payout_rem, per_unit_payout, per_unit_payout];

    for (idx, id) in supplier_ids.iter().enumerate() {
        let owner_id = {
            let eq = state.equipment.get_mut(*id).unwrap();
            eq.reserve_credits += reserves[idx];
            eq.cumulative_earned_credits += payouts[idx];
            eq.owner_id.clone()
        };
        let entry = state.account_credits.entry(owner_id).or_insert(0);
        *entry += payouts[idx];
    }

    let all_ids = ["gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"];
    for id in all_ids {
        let mut paid_treasury = 0u128;
        {
            let eq = state.equipment.get_mut(id).unwrap();
            eq.wear_bps = (eq.wear_bps + WEAR_PER_ACTIVE_TURN_BPS).min(10_000);
            if state.maintenance_reserve_bps > 0 && eq.reserve_credits >= AUTO_REPAIR_COST_CREDITS {
                eq.reserve_credits -= AUTO_REPAIR_COST_CREDITS;
                paid_treasury = AUTO_REPAIR_COST_CREDITS;
                eq.wear_bps = eq.wear_bps.saturating_sub(AUTO_REPAIR_WEAR_RECOVERY_BPS);
            }
            if eq.kind == "STORAGE_BATTERY" {
                let eff_cap = effective_capacity_kwh(eq.max_capacity_kwh, eq.wear_bps);
                if eq.charge_kwh > eff_cap {
                    eq.charge_kwh = eff_cap;
                }
            }
        }
        state.station_treasury_credits += paid_treasury;
    }

    let max_wear = all_ids
        .iter()
        .map(|id| state.equipment.get(*id).unwrap().wear_bps)
        .max()
        .unwrap_or(0);

    if !scrubber_solvent {
        state.o2_level = 0;
        state.station_status = "BLACKOUT".to_string();
        state.collapse_root_cause = Some("SCRUBBER_SOLVENCY_COLLAPSE".to_string());
    } else if max_wear >= CRITICAL_WEAR_THRESHOLD_BPS
        || (unmet_load_kwh > 0 && corridor_clamped_kwh == 0 && max_wear > 0)
    {
        state.o2_level = 0;
        state.station_status = "BLACKOUT".to_string();
        state.collapse_root_cause = Some("UNMAINTAINED_CAPACITY_DECAY".to_string());
    } else if unmet_load_kwh > 0 {
        state.o2_level = 0;
        state.station_status = "BLACKOUT".to_string();
        state.collapse_root_cause = Some("CORRIDOR_BOTTLENECK_BLACKOUT".to_string());
    } else {
        state.o2_level = 100;
        state.station_status = if turn >= state.max_turns {
            "SURVIVED".to_string()
        } else {
            "ACTIVE".to_string()
        };
        state.collapse_root_cause = None;
    }

    Ok(())
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AfterlightContract {
    pub equipment_by_token: LookupMap<String, EquipmentNft>,
    pub credits_by_account: LookupMap<AccountId, u128>,
    pub delegate_nonces: LookupMap<AccountId, u64>,
    pub turn: u64,
    pub station_status: String,
    pub collapse_root_cause: Option<String>,
    pub corridor_cap_kwh: u64,
    pub o2_level: u64,
    pub grid_price_tier: String,
    pub grid_price_per_kwh: u128,
    pub maintenance_reserve_bps: u64,
    pub colonist_demand_pool_credits: u128,
    pub station_treasury_credits: u128,
}

#[near]
impl AfterlightContract {
    #[init]
    pub fn new() -> Self {
        let initial = create_initial_pure_state(DEFAULT_CORRIDOR_CAP_KWH);
        let mut equipment_by_token = LookupMap::new(StorageKey::EquipmentByToken);
        for (token_id, eq) in initial.equipment {
            equipment_by_token.insert(token_id, eq);
        }
        let mut credits_by_account = LookupMap::new(StorageKey::CreditsByAccount);
        for (acct, bal) in initial.account_credits {
            if let Ok(parsed) = acct.parse::<AccountId>() {
                credits_by_account.insert(parsed, bal);
            }
        }
        Self {
            equipment_by_token,
            credits_by_account,
            delegate_nonces: LookupMap::new(StorageKey::DelegateNonces),
            turn: initial.turn,
            station_status: initial.station_status,
            collapse_root_cause: initial.collapse_root_cause,
            corridor_cap_kwh: initial.corridor_cap_kwh,
            o2_level: initial.o2_level,
            grid_price_tier: initial.grid_price_tier,
            grid_price_per_kwh: initial.grid_price_per_kwh,
            maintenance_reserve_bps: initial.maintenance_reserve_bps,
            colonist_demand_pool_credits: initial.colonist_demand_pool_credits,
            station_treasury_credits: initial.station_treasury_credits,
        }
    }

    pub fn set_policy(&mut self, grid_price_tier: String, maintenance_reserve_bps: u64) {
        require!(
            self.station_status != "BLACKOUT",
            "TerminalBlackoutImmutable"
        );
        let price = grid_price_for_tier(&grid_price_tier).expect("InvalidStationParameters");
        require!(
            maintenance_reserve_bps <= 10_000,
            "InvalidStationParameters"
        );
        self.grid_price_tier = grid_price_tier;
        self.grid_price_per_kwh = price;
        self.maintenance_reserve_bps = maintenance_reserve_bps;
    }

    pub fn nft_token(&self, token_id: String) -> Option<EquipmentNft> {
        self.equipment_by_token.get(&token_id).cloned()
    }

    pub fn nft_tokens_for_owner(&self, account_id: String) -> Vec<EquipmentNft> {
        let ids = ["gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"];
        ids.iter()
            .filter_map(|id| self.equipment_by_token.get(*id))
            .filter(|eq| eq.owner_id == account_id)
            .cloned()
            .collect()
    }

    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String) {
        require!(
            self.station_status != "BLACKOUT",
            "TerminalBlackoutImmutable"
        );
        let caller = env::predecessor_account_id().to_string();
        let mut eq = self
            .equipment_by_token
            .get(&token_id)
            .cloned()
            .expect("InvalidStationParameters");
        require!(eq.owner_id == caller, "UnauthorizedNftTransfer");
        require!(
            eq.owner_id != receiver_id.as_str(),
            "UnauthorizedNftTransfer"
        );
        let prev_owner = eq.owner_id.clone();
        eq.owner_id = receiver_id.to_string();
        eq.handover_history.push(EquipmentHandoverRecord {
            turn: self.turn,
            from_owner_id: prev_owner,
            to_owner_id: receiver_id.to_string(),
            preserved_wear_bps: eq.wear_bps,
            preserved_reserve_credits: eq.reserve_credits,
            preserved_charge_kwh: eq.charge_kwh,
        });
        if self.credits_by_account.get(&receiver_id).is_none() {
            self.credits_by_account.insert(receiver_id, 0);
        }
        self.equipment_by_token.insert(token_id, eq);
    }

    pub fn route_battery(&mut self, token_id: String, target_zone: String) {
        require!(
            self.station_status != "BLACKOUT",
            "TerminalBlackoutImmutable"
        );
        require!(
            target_zone == "SOLAR_ARRAY" || target_zone == "HABITAT_DOME",
            "InvalidStationParameters"
        );
        let mut eq = self
            .equipment_by_token
            .get(&token_id)
            .cloned()
            .expect("InvalidStationParameters");
        require!(eq.kind == "STORAGE_BATTERY", "NonMovableEquipment");
        eq.zone = target_zone;
        self.equipment_by_token.insert(token_id, eq);
    }

    pub fn repair_equipment(&mut self, token_id: String) {
        require!(
            self.station_status != "BLACKOUT",
            "TerminalBlackoutImmutable"
        );
        let caller = env::predecessor_account_id().to_string();
        let mut eq = self
            .equipment_by_token
            .get(&token_id)
            .cloned()
            .expect("InvalidStationParameters");
        require!(eq.owner_id == caller, "UnauthorizedNftTransfer");
        require!(
            eq.reserve_credits >= AUTO_REPAIR_COST_CREDITS,
            "InsufficientRepairReserve"
        );
        eq.reserve_credits -= AUTO_REPAIR_COST_CREDITS;
        self.station_treasury_credits += AUTO_REPAIR_COST_CREDITS;
        eq.wear_bps = eq.wear_bps.saturating_sub(1_200);
        if eq.kind == "STORAGE_BATTERY" {
            let eff_cap = effective_capacity_kwh(eq.max_capacity_kwh, eq.wear_bps);
            eq.charge_kwh = eq.charge_kwh.min(eff_cap);
        }
        self.equipment_by_token.insert(token_id, eq);
    }

    pub fn advance_turn(&mut self) {
        let ids = ["gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"];
        let mut equipment = BTreeMap::new();
        let mut account_credits = BTreeMap::new();
        for id in ids {
            let eq = self
                .equipment_by_token
                .get(id)
                .cloned()
                .expect("InvalidStationParameters");
            if let Ok(owner_acct) = eq.owner_id.parse::<AccountId>() {
                let bal = self.credits_by_account.get(&owner_acct).copied().unwrap_or(0);
                account_credits.insert(eq.owner_id.clone(), bal);
            }
            equipment.insert(id.to_string(), eq);
        }
        let mut pure_state = PureStationState {
            turn: self.turn,
            max_turns: ORBIT_WEEK_TURNS,
            station_status: self.station_status.clone(),
            collapse_root_cause: self.collapse_root_cause.clone(),
            corridor_cap_kwh: self.corridor_cap_kwh,
            o2_level: self.o2_level,
            grid_price_tier: self.grid_price_tier.clone(),
            grid_price_per_kwh: self.grid_price_per_kwh,
            maintenance_reserve_bps: self.maintenance_reserve_bps,
            colonist_demand_pool_credits: self.colonist_demand_pool_credits,
            station_treasury_credits: self.station_treasury_credits,
            account_credits,
            equipment,
        };
        step_pure_turn(&mut pure_state).unwrap_or_else(|err| env::panic_str(err));
        self.turn = pure_state.turn;
        self.station_status = pure_state.station_status;
        self.collapse_root_cause = pure_state.collapse_root_cause;
        self.o2_level = pure_state.o2_level;
        self.colonist_demand_pool_credits = pure_state.colonist_demand_pool_credits;
        self.station_treasury_credits = pure_state.station_treasury_credits;
        for (acct_str, bal) in pure_state.account_credits {
            if let Ok(parsed) = acct_str.parse::<AccountId>() {
                self.credits_by_account.insert(parsed, bal);
            }
        }
        for (id, eq) in pure_state.equipment {
            self.equipment_by_token.insert(id, eq);
        }
    }

    pub fn execute_nep366_delegate(
        &mut self,
        sender_id: AccountId,
        nonce: u64,
        max_block_height: u64,
        method_name: String,
    ) {
        require!(
            env::predecessor_account_id() == sender_id,
            "UnauthorizedDelegateCaller"
        );
        require!(
            env::attached_deposit().as_yoctonear() == 0,
            "NonZeroAttachedDepositForbidden"
        );
        require!(
            env::block_height() <= max_block_height,
            "ExpiredMaxBlockHeight"
        );
        let last_nonce = self.delegate_nonces.get(&sender_id).copied().unwrap_or(0);
        require!(nonce > last_nonce, "StaleDelegateNonce");
        require!(
            matches!(
                method_name.as_str(),
                "set_policy" | "route_battery" | "nft_transfer" | "repair_equipment" | "advance_turn"
            ),
            "DisallowedDelegateActionKind"
        );
        self.delegate_nonces.insert(sender_id, nonce);
    }

    pub fn ft_total_supply(&self) -> u128 {
        INITIAL_TOTAL_STATION_CREDITS
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> u128 {
        self.credits_by_account.get(&account_id).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenVector {
        id: String,
        corridor_cap_kwh: u64,
        grid_price_tier: String,
        maintenance_reserve_bps: u64,
        bat_alpha_zone: String,
        bat_beta_zone: String,
        turns_to_run: u64,
        expected_final_turn: u64,
        expected_status: String,
        expected_collapse_root_cause: Option<String>,
        expected_total_credits: u128,
        expected_o2_level: u64,
        expected_gen_solar_wear_bps: u64,
        expected_colonist_credits: u128,
        expected_treasury_credits: u128,
    }

    #[test]
    fn golden_turn_vectors_match_typescript_engine() {
        let raw = include_str!("../../../src/scenarios/golden-turn-vectors.json");
        let vectors: Vec<GoldenVector> = serde_json::from_str(raw).expect("valid golden json");
        assert!(vectors.len() >= 3);

        for vec in vectors {
            let mut state = create_initial_pure_state(vec.corridor_cap_kwh);
            state.grid_price_tier = vec.grid_price_tier.clone();
            state.grid_price_per_kwh = grid_price_for_tier(&vec.grid_price_tier).unwrap();
            state.maintenance_reserve_bps = vec.maintenance_reserve_bps;
            state.equipment.get_mut("bat-alpha-1").unwrap().zone = vec.bat_alpha_zone.clone();
            state.equipment.get_mut("bat-beta-2").unwrap().zone = vec.bat_beta_zone.clone();

            for _ in 0..vec.turns_to_run {
                if step_pure_turn(&mut state).is_err() {
                    break;
                }
            }

            assert_eq!(state.turn, vec.expected_final_turn, "turn mismatch on {}", vec.id);
            assert_eq!(state.station_status, vec.expected_status, "status mismatch on {}", vec.id);
            assert_eq!(
                state.collapse_root_cause, vec.expected_collapse_root_cause,
                "collapse_root_cause mismatch on {}",
                vec.id
            );
            assert_eq!(
                sum_pure_station_credits(&state),
                vec.expected_total_credits,
                "total credits conservation mismatch on {}",
                vec.id
            );
            assert_eq!(state.o2_level, vec.expected_o2_level, "o2_level mismatch on {}", vec.id);
            assert_eq!(
                state.equipment.get("gen-solar-1").unwrap().wear_bps,
                vec.expected_gen_solar_wear_bps,
                "gen-solar-1 wear_bps mismatch on {}",
                vec.id
            );
            assert_eq!(
                state.colonist_demand_pool_credits,
                vec.expected_colonist_credits,
                "colonist credits mismatch on {}",
                vec.id
            );
            assert_eq!(
                state.station_treasury_credits,
                vec.expected_treasury_credits,
                "treasury credits mismatch on {}",
                vec.id
            );
        }
    }

    #[test]
    fn pure_skim_decay_triggers_unmaintained_capacity_decay() {
        let mut state = create_initial_pure_state(DEFAULT_CORRIDOR_CAP_KWH);
        assert!(state.equipment.contains_key("gen-solar-1"));
        assert_eq!(
            state.account_credits.get("commander-a.afterlight.testnet").copied(),
            Some(1_200)
        );
        state.grid_price_tier = "BALANCED".to_string();
        state.grid_price_per_kwh = grid_price_for_tier("BALANCED").unwrap();
        state.maintenance_reserve_bps = 0;
        for _ in 0..4 {
            let _ = step_pure_turn(&mut state);
        }
        assert_eq!(state.turn, 4);
        assert_eq!(state.station_status, "BLACKOUT");
        assert_eq!(
            state.collapse_root_cause,
            Some("UNMAINTAINED_CAPACITY_DECAY".to_string())
        );
    }
}
