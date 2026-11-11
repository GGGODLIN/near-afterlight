import assert from "node:assert/strict";
import test from "node:test";
import deployment from "../src/near/deployment.json" with { type: "json" };
import { readTestnetState } from "../src/near/testnet-state.ts";

function rpcFixture(options: { badReceipt?: boolean; badMetadata?: boolean } = {}): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, string> };
    let result: unknown;
    if (body.method === "block") {
      result = { header: { height: 123, hash: "finalized-block" } };
    } else if (body.method === "query") {
      assert.equal(body.params.block_id, "finalized-block");
      const args = JSON.parse(Buffer.from(body.params.args_base64, "base64").toString()) as { token_id: string };
      const value = body.params.method_name === "nft_metadata"
        ? { spec: options.badMetadata ? "invalid" : "nft-1.0.0", name: "Equipment", symbol: "AFT" }
        : { token_id: args.token_id, owner_id: deployment.contractId,
            metadata: { title: "Battery", extra: "{}" }, equipment: { wearBps: 100, chargeKwh: 47, zone: "HABITAT_DOME", reserveCredits: 200 } };
      result = { result: [...Buffer.from(JSON.stringify(value))] };
    } else {
      const tx = deployment.transactions.find(tx => tx.hash === body.params.tx_hash);
      assert.ok(tx);
      result = {
        status: options.badReceipt ? { Failure: "rejected" } : { SuccessValue: "" },
        transaction: { hash: tx.hash, signer_id: tx.signerId, receiver_id: deployment.contractId,
          actions: [{ [tx.label === "deploy" || tx.label === "redeploy" ? "DeployContract" : tx.label === "native-nep366-route" ? "Delegate" : "FunctionCall"]: {} }] },
        receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
      };
    }
    return Response.json({ jsonrpc: "2.0", result });
  };
}

test("RPC report verifies finalized metadata, dynamic NFTs and actual transaction outcomes", async () => {
  const report = await readTestnetState(rpcFixture());
  assert.equal(report.passed, true);
  assert.equal(report.tokens.length, 4);
  assert.equal(report.tokens[0].equipment.wearBps, 100);
  assert.equal(report.transactions.every(tx => tx.succeeded), true);
});

test("RPC falls back after primary transport failure and reports the actual endpoint", async () => {
  const fixture = rpcFixture();
  const report = await readTestnetState(async (input, init) => {
    if (input === "https://rpc.testnet.near.org") return new Response("rate limited", { status: 429 });
    assert.equal(input, "https://test.rpc.fastnear.com");
    return fixture(input, init);
  });
  assert.equal(report.passed, true);
  assert.equal(report.rpcUrl, "https://test.rpc.fastnear.com");
});

test("RPC verification fails closed on transaction failure, invalid metadata and network outage", async () => {
  assert.equal((await readTestnetState(rpcFixture({ badReceipt: true }))).passed, false);
  assert.equal((await readTestnetState(rpcFixture({ badMetadata: true }))).passed, false);
  const unavailable = await readTestnetState(async () => { throw new Error("offline"); });
  assert.equal(unavailable.passed, false);
  assert.equal(unavailable.error, "offline");
});
