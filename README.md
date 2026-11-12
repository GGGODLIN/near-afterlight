# Afterlight — Orbital Power-Grid & Dynamic Equipment NFT Survival Game on NEAR

[English](/README.md) | [繁體中文](/README.zh-TW.md)

Built for **NEAR Hackathon 2026** (`https://nearhackathon.com/`).

- **Live Interactive Command Deck**: [https://near-afterlight.vercel.app](https://near-afterlight.vercel.app)
- **Public GitHub Repository**: [https://github.com/GGGODLIN/near-afterlight](https://github.com/GGGODLIN/near-afterlight)
- **X (Twitter) Demo Post**: [https://x.com/GGGODLIN/status/2119268196062798316](https://x.com/GGGODLIN/status/2119268196062798316)
- **Tracks**: `games` (Games With Real Economies), `nfts` (NFTs That Do Something)

> **Independent Submission Disclosure (`Q-015`)**: Per NEAR Hackathon Rule `Q-015` (*"Allowed if projects are independent and disclosed: each README names the other project"*), this participant submitted two completely independent entries with zero overlapping tracks and zero shared domain logic:
> 1. **[GhostShift](https://github.com/GGGODLIN/near-ghost-shift)** — Monotonic Epoch Fencing & Yield-Resume Handoff Gate (`tracks`: `security`, `swarms`, `agents`, `business`, `open`).
> 2. **Afterlight** (this repository) — Orbital Station Power-Grid & Dynamic `NEP-171` Equipment NFT Survival Game (`tracks`: `games`, `nfts`).

https://github.com/user-attachments/assets/17458f9b-6380-4bfa-a8e4-e19b7a73ef0a

![Afterlight — The 45 kWh Chokepoint (45s Film Storyboard)](/docs/assets/stills.png)

![Afterlight — Orbital Station Cross-Section Command Deck (14/14 Survived)](/docs/assets/01-station-deck-daylight-and-survived.jpg)

![Afterlight — Turn 2 Corridor Bottleneck Blackout & Single Root-Cause Autopsy](/docs/assets/02-station-deck-blackout-autopsy.jpg)

![Afterlight — Collapsible Judge & On-Chain Inspector Drawer](/docs/assets/03-judge-onchain-inspector-drawer.jpg)

---

## The Problem: Having Power Does Not Mean It Can Reach the Habitat

Across 14 half-orbit turns (7 orbital Daylight / Eclipse cycles), an orbital colony depends on three interconnected zones:

1. **Solar Array (`SOLAR_ARRAY`)**: Houses `gen-solar-1` (`Helios-IX Solar Array NFT`), which generates `100 kWh` base power during Daylight turns and `0 kWh` during Eclipse turns (`-150°C` orbital shadow).
2. **Transmission Corridor (`TRANSMISSION_CORRIDOR`)**: Enforces a hard physical transmission bottleneck (`corridorCapKwh = 45 kWh/turn`) between the Solar Array and the Habitat Dome.
3. **Habitat & O2 Dome (`HABITAT_DOME`)**: Houses `o2-scrubber-1` (`Aegis-IV O2 Scrubber NFT`) and colonists requiring `35 kWh/turn` in Daylight and `50 kWh/turn` in Eclipse (`35 kWh` habitat + thermal heaters + `15 kWh` O2 scrubber).

Because Eclipse load (`50 kWh`) exceeds the Transmission Corridor capacity cap (`45 kWh`), **even if both `CryoCell` storage batteries (`bat-alpha-1` and `bat-beta-2`) are 100% charged inside `SOLAR_ARRAY`, the corridor saturates at `45 kWh` and the Habitat blacks out (`CORRIDOR_BOTTLENECK_BLACKOUT`)**. Simultaneously, if the commander sets a greedy `SURGE` electricity tariff (`8 CR/kWh`), `o2-scrubber-1` bleeds its operating reserve and goes bankrupt on Turn 4 (`SCRUBBER_SOLVENCY_COLLAPSE`); if maintenance retention is set to `0 bps` (`Skim`), equipment wear degrades effective capacity until life support fails (`UNMAINTAINED_CAPACITY_DECAY`).

---

## How Afterlight Uses Native NEAR Primitives

1. **Dynamic `NEP-171` Equipment NFTs (`contracts/afterlight/src/lib.rs`, `near-sdk = "=5.29.0"`)**:
   - Four equipment NFTs are deployed and minted on NEAR Testnet. `nft_metadata` returns NEP-177 contract metadata; `nft_token` and paginated `nft_tokens_for_owner` return standard `token_id`, `owner_id`, and `metadata`, with dynamic equipment fields in `equipment` and `metadata.extra`. The inspector reads finalized RPC state separately from guest simulation state. Transfers preserve wear, charge, reserves, and zone; `handoverHistory` records ownership changes.
   - Transferring an NFT (`nft_transfer`) transfers future electricity revenue and locked `reserveCredits` to the new operator while strictly preserving `wearBps`, `chargeKwh`, and `zone` (`P3` Non-Laundering Invariance: selling an NFT cannot reset its wear or double-claim reserves).
2. **Closed-Loop Station Credit Ledger (inspired by `NEP-141` accounting; not a transferable FT)**:
   - Total station credits (`10,000 CR`) circulate in a closed loop across `operatorA`, `operatorB`, `colonistDemandPool`, `stationTreasury`, and individual NFT `reserveCredits` (`P1` Currency Conservation).
3. **Two-Layer `NEP-366` Gasless Ephemeral Session Guard (`src/engine/nep366-session-guard.ts`)**:
   - Guest commands use randomly generated local Ed25519 session keys. Verification binds the full action, sender, receiver, deposit, nonce, and expiry to a trusted local public key. These application envelopes are local simulations, not NEP-366 wire messages or authorization for real NEAR accounts. The deployment script separately signs and broadcasts a native NEP-366 `SignedDelegate` through an independent relayer; NEAR verifies the account access key before the contract dispatches the action.
4. **Cross-Language Integer Basis-Point (`bps: 0..10_000`) Golden Vector Parity**:
   - Both the NEAR Rust smart contract (`contracts/afterlight/src/lib.rs`) and the isomorphic TypeScript engine (`src/engine/afterlight-engine.ts`) execute the exact same 6-step integer `bps` turn pipeline verified against `src/scenarios/golden-turn-vectors.json`.

---

## Reproducible Judge Steps ("Do X, See Y" — Under 60 Seconds)

### Step 1: Run the 60-Second AI Judge Verification Suite (`Q-017`)
- **Do X**:
  ```bash
  npm install
  npm run verify:judge
  ```
- **See Y**:
  - Prints `"verdict": "PASS"` and `"tracks": ["games", "nfts"]` only when the local suite and live Testnet RPC verification pass. Network failure yields FAIL with an error. The primary RPC is [NEAR Testnet RPC](https://rpc.testnet.near.org); transport errors fall back to [FastNEAR Testnet RPC](https://test.rpc.fastnear.com), and the report identifies the endpoint used.
  - Checks Rust source structure and 3 cross-language golden vectors locally; this is not a Rust execution test. The live check reads `nft_metadata`, all four NFTs at one finalized block, and verifies deployment, mint, state-update, and native relay transaction outcomes.
  - Runs 200 randomized 14-turn schedules via `fast-check` against the independent Oracle for currency conservation, energy balance, NFT transfer invariants, corridor capacity and blackout finality, with reachability witness floors.
  - Checks 6 signed-envelope cases, including payload, signature and public-key substitution rejection, and replays the 3 survival trajectories.

### Step 2: Run the Full Unit, Property-Based & Rust Contract Test Suite
- **Do X**:
  ```bash
  node --experimental-strip-types --test --test-concurrency=3 tests/*.test.ts
  PATH="$HOME/.cargo/bin:$PATH" CARGO_BUILD_JOBS=3 cargo test --manifest-path contracts/afterlight/Cargo.toml
  ```
- **See Y**:
  - On 2026-11-11 these commands passed 17 Node tests and 8 Rust tests, including metadata, mint, dispatch, replay rejection and transfer preservation. The API test uses real Testnet RPC; RPC fixture tests separately cover failure handling.

### Step 3: Play the Interactive Orbital Station Command Deck
- **Do X**:
  Run `npm run dev` and open `http://localhost:3000`.
- **See Y**:
  - Adjust the 3 tactical controls (**Grid Price Tier**, **Maintenance Reserve Retention**, **Battery Zone Routing**), trigger **Fast-Forward 7 Days (14 Turns)** across the 3 trajectory presets, test 1-click **`Handover NFT to Operator B`** vs. **`Simulate Exploit: Wash Wear / Unauthorized Siphon`**, and open the **Judge & On-Chain Inspector** drawer (`Run Judge Verification`).


## Testnet deployment and transaction evidence

Guest rounds remain local. Run Judge Verification to fetch finalized Testnet NFT state and receipts. The on-chain demonstration was deployed, minted and updated on 2026-11-11.

[Afterlight Testnet contract](https://testnet.nearblocks.io/address/afterlight-v1-mwby3nj0.testnet)

| Transaction | Explorer receipt |
|---|---|
| deploy | [GYVTuUtmJnC9pB79tjiKGZVFRKMvqMaQcyXntZVybUUx](https://testnet.nearblocks.io/txns/GYVTuUtmJnC9pB79tjiKGZVFRKMvqMaQcyXntZVybUUx) |
| initialize | [5BmgHMTkxrSrD2G2S6dr1imYW7Y8p4T5CNTfZeQqL97U](https://testnet.nearblocks.io/txns/5BmgHMTkxrSrD2G2S6dr1imYW7Y8p4T5CNTfZeQqL97U) |
| mint-gen-solar-1 | [6MjMeAwhKF1o9wRUPkDara7VVpEWL4ZDna7Wm95fosuo](https://testnet.nearblocks.io/txns/6MjMeAwhKF1o9wRUPkDara7VVpEWL4ZDna7Wm95fosuo) |
| mint-bat-alpha-1 | [HuYC9HgeyJUsey4kPDnpPEBHUsPuUGZ71Qj9SEoJH5eP](https://testnet.nearblocks.io/txns/HuYC9HgeyJUsey4kPDnpPEBHUsPuUGZ71Qj9SEoJH5eP) |
| mint-bat-beta-2 | [BStaVR86U7WpdoEvNETnLo83M5fVufuQACQJGyVg9v8a](https://testnet.nearblocks.io/txns/BStaVR86U7WpdoEvNETnLo83M5fVufuQACQJGyVg9v8a) |
| mint-o2-scrubber-1 | [EJHyBwGqWpnz94aQNFE4z9Xuv6KoZV4ENBxhaSyi6y9c](https://testnet.nearblocks.io/txns/EJHyBwGqWpnz94aQNFE4z9Xuv6KoZV4ENBxhaSyi6y9c) |
| delegate-route | [8n5xou9v9tBdGrwSxqfVdWfS5ArLSUNHAZGpYrWuqFX1](https://testnet.nearblocks.io/txns/8n5xou9v9tBdGrwSxqfVdWfS5ArLSUNHAZGpYrWuqFX1) |
| delegate-advance | [BLqkt6q4vx9kTCG4nfVM9zg276Puhux3SPTaxNiS8mLx](https://testnet.nearblocks.io/txns/BLqkt6q4vx9kTCG4nfVM9zg276Puhux3SPTaxNiS8mLx) |
| redeploy | [67NMsc33qXGuLoVUugEvx5qE1JpF7t1tfDcLdrfUuUVR](https://testnet.nearblocks.io/txns/67NMsc33qXGuLoVUugEvx5qE1JpF7t1tfDcLdrfUuUVR) |
| create-relayer | [AaYqaeRMZzkexdDkBGhRzZzR91eXgp6hbcAosfURENwY](https://testnet.nearblocks.io/txns/AaYqaeRMZzkexdDkBGhRzZzR91eXgp6hbcAosfURENwY) |
| native-nep366-route | [GMdyyfece3qMreHPkFWogrL1Urgz7biCy4bVfBE7wGxk](https://testnet.nearblocks.io/txns/GMdyyfece3qMreHPkFWogrL1Urgz7biCy4bVfBE7wGxk) |

The manifest is [deployment.json](/src/near/deployment.json). To deploy a separate demonstration, build with the command below and run [deploy-testnet.mjs](/scripts/deploy-testnet.mjs) with `AFTERLIGHT_RECEIPT_DIR` pointing outside the repo. Credentials stay there with mode `0600`; the script writes only public transaction data into the manifest. `NEAR_RPC_URL` can select an alternative Testnet RPC.

```bash
PATH="$HOME/.cargo/bin:$PATH" CARGO_BUILD_JOBS=3 RUSTFLAGS="-C target-feature=-reference-types,-multivalue -C link-arg=-s" cargo build --release --target wasm32-unknown-unknown --manifest-path contracts/afterlight/Cargo.toml
```

The contract retains an upgrade key for this Testnet demonstration. It supports the NEP-171 core and metadata with owner-only minting, not approval management or a production wallet integration.
