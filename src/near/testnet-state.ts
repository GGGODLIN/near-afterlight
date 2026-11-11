import deployment from "./deployment.json" with { type: "json" };

export interface OnChainToken {
  token_id: string;
  owner_id: string;
  metadata: { title: string; extra: string };
  equipment: {
    zone: string;
    chargeKwh: number;
    wearBps: number;
    reserveCredits: number;
  };
}

export interface ChainTransaction {
  label: string;
  hash: string;
  signerId: string;
  explorerUrl: string;
  succeeded: boolean;
}

export interface TestnetReport {
  network: "testnet";
  contractId: string;
  rpcUrl: string;
  checkedAt: string;
  blockHeight: number | null;
  metadata: { spec: string; name: string; symbol: string } | null;
  tokens: OnChainToken[];
  transactions: ChainTransaction[];
  passed: boolean;
  error: string | null;
}

export type RpcFetch = typeof fetch;

export async function readTestnetState(fetcher: RpcFetch = fetch): Promise<TestnetReport> {
  const report: TestnetReport = {
    network: "testnet", contractId: deployment.contractId, rpcUrl: deployment.rpcUrl,
    checkedAt: new Date().toISOString(), blockHeight: null,
    metadata: null, tokens: [], transactions: [], passed: false, error: null,
  };
  let sequence = 0;
  async function rpc(method: string, params: object): Promise<unknown> {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: ++sequence, method, params });
    const request = (url: string) => fetcher(url, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(15_000), body: payload,
    });
    let response: Response;
    try {
      response = await request(report.rpcUrl);
      if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
    } catch {
      report.rpcUrl = "https://test.rpc.fastnear.com";
      response = await request(report.rpcUrl);
      if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
    }
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || body.result === undefined) throw new Error("NEAR RPC returned an error");
    return body.result;
  }
  try {
    if (!deployment.contractId) throw new Error("Testnet deployment is not configured");
    const block = await rpc("block", { finality: "final" }) as { header: { height: number; hash: string } };
    report.blockHeight = block.header.height;
    async function view(method: string, args: object): Promise<unknown> {
      const result = await rpc("query", {
        request_type: "call_function", account_id: deployment.contractId,
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        block_id: block.header.hash,
      }) as { result: number[] };
      return JSON.parse(Buffer.from(result.result).toString("utf8")) as unknown;
    }
    const [metadata, tokens, transactions] = await Promise.all([
      view("nft_metadata", {}),
      Promise.all(["gen-solar-1", "bat-alpha-1", "bat-beta-2", "o2-scrubber-1"].map(token_id => view("nft_token", { token_id }))),
      Promise.all(deployment.transactions.filter(tx => tx.label !== "create-relayer").map(async (tx) => {
        const result = await rpc("tx", { tx_hash: tx.hash, sender_account_id: tx.signerId, wait_until: "FINAL" }) as {
          status: { SuccessValue?: string; Failure?: unknown };
          transaction: { hash: string; signer_id: string; receiver_id: string; actions: Array<Record<string, unknown>> };
          receipts_outcome: Array<{ outcome: { status: { Failure?: unknown } } }>;
        };
        const expectedAction = tx.label === "deploy" || tx.label === "redeploy" ? "DeployContract" :
          tx.label === "native-nep366-route" ? "Delegate" : "FunctionCall";
        const succeeded = Object.hasOwn(result.status, "SuccessValue") &&
          result.transaction.hash === tx.hash && result.transaction.signer_id === tx.signerId &&
          result.transaction.receiver_id === deployment.contractId &&
          result.transaction.actions.some(action => Object.hasOwn(action, expectedAction)) &&
          result.receipts_outcome.every(receipt => !receipt.outcome.status.Failure);
        return { ...tx, succeeded, explorerUrl: `https://testnet.nearblocks.io/txns/${tx.hash}` };
      })),
    ]);
    const meta = metadata as NonNullable<TestnetReport["metadata"]>;
    if (meta.spec !== "nft-1.0.0" || !meta.name || !meta.symbol) throw new Error("Invalid NFT contract metadata");
    report.metadata = meta;
    report.tokens = tokens as OnChainToken[];
    if (!report.tokens.every(token => token && token.token_id && token.owner_id && token.metadata?.extra &&
      Number.isFinite(token.equipment?.wearBps))) throw new Error("Invalid dynamic NFT state");
    report.transactions = transactions;
    report.passed = transactions.some(tx => tx.label === "deploy") &&
      transactions.filter(tx => tx.label.startsWith("mint-")).length === 4 &&
      transactions.some(tx => tx.label === "delegate-advance") && transactions.every(tx => tx.succeeded);
    if (!report.passed) report.error = "Deployment, mint or state-update receipts failed verification";
  } catch (error: unknown) {
    report.error = error instanceof Error ? error.message : "NEAR RPC unavailable";
  }
  return report;
}
