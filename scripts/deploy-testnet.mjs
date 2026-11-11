import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, buildDelegateAction, actions } from "near-api-js";

const receiptDir = process.env.AFTERLIGHT_RECEIPT_DIR;
if (!receiptDir) throw new Error("AFTERLIGHT_RECEIPT_DIR required (outside git)");
const repoRoot = fs.realpathSync(fileURLToPath(new URL("..", import.meta.url)));
fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
const realReceiptDir = fs.realpathSync(receiptDir);
if (realReceiptDir === repoRoot || realReceiptDir.startsWith(`${repoRoot}${path.sep}`)) {
  throw new Error("Credentials must be stored outside the repository");
}
const credentialPath = path.join(receiptDir, "testnet-account.json");
let credentials;
if (fs.existsSync(credentialPath)) {
  credentials = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
} else {
  const key = KeyPair.fromRandom("ed25519");
  credentials = {
    accountId: `afterlight-v1-${Date.now().toString(36)}.testnet`,
    publicKey: key.getPublicKey().toString(),
    privateKey: key.toString(),
  };
  fs.writeFileSync(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
}
const rpcUrl = "https://rpc.testnet.near.org";
const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? rpcUrl });
const account = new Account(credentials.accountId, provider, credentials.privateKey);
const receiptPath = path.join(receiptDir, "deployment.json");
const deployment = fs.existsSync(receiptPath)
  ? JSON.parse(fs.readFileSync(receiptPath, "utf8"))
  : { network: "testnet", rpcUrl, contractId: credentials.accountId, transactions: [] };
function save(label, result) {
  fs.writeFileSync(path.join(receiptDir, `${label}.json`), JSON.stringify(result, null, 2));
  if (result.status?.Failure) throw new Error(`${label} failed: ${JSON.stringify(result.status.Failure)}`);
  if (result.transaction) {
    const hash = result.transaction.hash;
    deployment.transactions.push({ label, hash, signerId: result.transaction.signer_id });
    fs.writeFileSync(receiptPath, JSON.stringify(deployment, null, 2));
    process.stdout.write(`${JSON.stringify({ label, hash })}\n`);
  }
}
let exists = false;
try { await account.getState(); exists = true; } catch (error) {
  if (!String(error).includes("does not exist") && !String(error).includes("UNKNOWN_ACCOUNT")) throw error;
}
if (!exists) {
  const response = await fetch("https://helper.testnet.near.org/account", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ newAccountId: credentials.accountId, newAccountPublicKey: credentials.publicKey }),
  });
  const result = await response.json();
  fs.writeFileSync(path.join(receiptDir, "faucet.json"), JSON.stringify(result, null, 2));
  if (!response.ok) throw new Error(`Faucet ${response.status}: ${JSON.stringify(result)}`);
  process.stdout.write(`${JSON.stringify({ created: credentials.accountId })}\n`);
}
if (!deployment.transactions.some(t => t.label === "deploy")) {
  save("deploy", await account.deployContract(fs.readFileSync("contracts/afterlight/target/wasm32-unknown-unknown/release/afterlight_contract.wasm")));
}
async function call(label, methodName, args, deposit = 0n) {
  if (deployment.transactions.some(t => t.label === label)) return;
  save(label, await account.callFunctionRaw({ contractId: credentials.accountId, methodName, args, gas: 100_000_000_000_000n, deposit, waitUntil: "FINAL" }));
}
await call("initialize", "new", {});
for (const tokenId of ["gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"]) {
  await call(`mint-${tokenId}`, "nft_mint", { token_id: tokenId, receiver_id: credentials.accountId }, 10n ** 23n);
}
const block = await provider.viewBlock({ finality: "final" });
await call("delegate-route", "execute_nep366_delegate", {
  sender_id: credentials.accountId, nonce: 1, max_block_height: block.header.height + 1000,
  method_name: "route_battery", action: { kind: "RouteBattery", token_id: "bat-alpha-1", target_zone: "HABITAT_DOME" },
});
await call("delegate-advance", "execute_nep366_delegate", {
  sender_id: credentials.accountId, nonce: 2, max_block_height: block.header.height + 1000,
  method_name: "advance_turn", action: { kind: "AdvanceTurn" },
});
if (process.argv.includes("--redeploy")) {
  save("redeploy", await account.deployContract(fs.readFileSync("contracts/afterlight/target/wasm32-unknown-unknown/release/afterlight_contract.wasm")));
}
const relayPath = path.join(receiptDir, "relayer-account.json");
let relay;
if (fs.existsSync(relayPath)) {
  relay = JSON.parse(fs.readFileSync(relayPath, "utf8"));
} else {
  const key = KeyPair.fromRandom("ed25519");
  relay = { accountId: `relay.${credentials.accountId}`, privateKey: key.toString(), publicKey: key.getPublicKey().toString() };
  fs.writeFileSync(relayPath, JSON.stringify(relay), { mode: 0o600 });
}
if (!deployment.transactions.some(t => t.label === "create-relayer")) {
  save("create-relayer", await account.createAccount({ newAccountId: relay.accountId, publicKey: relay.publicKey, nearToTransfer: 10n ** 24n }));
}
if (!deployment.transactions.some(t => t.label === "native-nep366-route")) {
  const signer = KeyPairSigner.fromSecretKey(credentials.privateKey);
  const publicKey = await signer.getPublicKey();
  const access = await account.getAccessKey(publicKey);
  const latest = await provider.viewBlock({ finality: "final" });
  const delegate = buildDelegateAction({
    senderId: credentials.accountId, receiverId: credentials.accountId, publicKey,
    nonce: BigInt(access.nonce) + 1n, maxBlockHeight: BigInt(latest.header.height + 1000),
    actions: [actions.functionCall("execute_nep366_delegate", {
      sender_id: credentials.accountId, nonce: 3, max_block_height: latest.header.height + 1000,
      method_name: "route_battery", action: { kind: "RouteBattery", token_id: "bat-beta-2", target_zone: "HABITAT_DOME" },
    }, 100_000_000_000_000n, 0n)],
  });
  const { signedDelegate } = await signer.signDelegateAction(delegate);
  const relayer = new Account(relay.accountId, provider, relay.privateKey);
  save("native-nep366-route", await relayer.relayMetaTransaction(signedDelegate));
}
for (const [label, method, args] of [
  ["nft-metadata", "nft_metadata", {}],
  ["nft-token", "nft_token", { token_id: "bat-alpha-1" }],
  ["nft-owner", "nft_tokens_for_owner", { account_id: credentials.accountId }],
  ["station", "get_station", {}],
]) {
  const result = await provider.callFunction({ contractId: credentials.accountId, method, args });
  fs.writeFileSync(path.join(receiptDir, `${label}.json`), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify({ label, result })}\n`);
}
fs.writeFileSync("src/near/deployment.json", JSON.stringify(deployment, null, 2) + "\n");
