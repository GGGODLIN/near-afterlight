import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { POST as simulatePost } from "../app/api/simulate/route.ts";
import { GET as verifyGet } from "../app/api/verify/route.ts";

test("Ticket 03.1 (Failure F2): POST /api/simulate returns 200 with 14-turn receipts and collapseAutopsy for presets/custom schedules, and 400 on invalid input", async () => {
  // Preset 01: Greedy surge collapse
  const reqGreedy = new Request("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "01-greedy-surge-collapse" }),
  });
  const resGreedy = await simulatePost(reqGreedy);
  assert.equal(resGreedy.status, 200);
  const bodyGreedy = (await resGreedy.json()) as {
    finalState: { stationStatus: string; collapseRootCause: string | null };
    turnReceipts: unknown[];
    nftFleetState: unknown[];
    collapseAutopsy: {
      headline: string;
      failureTurn: number | null;
      rootCause: string | null;
      remediationHint: string;
    };
  };
  assert.equal(bodyGreedy.finalState.stationStatus, "BLACKOUT");
  assert.equal(
    bodyGreedy.finalState.collapseRootCause,
    "SCRUBBER_SOLVENCY_COLLAPSE",
  );
  assert.equal(bodyGreedy.collapseAutopsy.rootCause, "SCRUBBER_SOLVENCY_COLLAPSE");
  assert.equal(bodyGreedy.collapseAutopsy.failureTurn, 4);
  assert.equal(bodyGreedy.nftFleetState.length, 4);

  // Malformed JSON -> HTTP 400 InvalidSimulationRequest
  const reqBadJson = new Request("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{bad-json",
  });
  const resBadJson = await simulatePost(reqBadJson);
  assert.equal(resBadJson.status, 400);
  const bodyBadJson = (await resBadJson.json()) as { error: string };
  assert.equal(bodyBadJson.error, "InvalidSimulationRequest");

  // Unknown presetId -> HTTP 400 InvalidSimulationRequest
  const reqBadPreset = new Request("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "99-nonexistent-preset" }),
  });
  const resBadPreset = await simulatePost(reqBadPreset);
  assert.equal(resBadPreset.status, 400);
});

test("Ticket 03.2 (Failure F1): Switching from BLACKOUT preset to 03-balanced-survival-walkthrough clears collapseRootCause and restores SURVIVED", async () => {
  const reqBlackout = new Request("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "02-corridor-bottleneck-blackout" }),
  });
  const resBlackout = await simulatePost(reqBlackout);
  const bodyBlackout = (await resBlackout.json()) as {
    finalState: { stationStatus: string; collapseRootCause: string | null };
    collapseAutopsy: { rootCause: string | null };
  };
  assert.equal(bodyBlackout.finalState.stationStatus, "BLACKOUT");
  assert.equal(
    bodyBlackout.finalState.collapseRootCause,
    "CORRIDOR_BOTTLENECK_BLACKOUT",
  );

  const reqSurvived = new Request("http://localhost:3000/api/simulate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ presetId: "03-balanced-survival-walkthrough" }),
  });
  const resSurvived = await simulatePost(reqSurvived);
  assert.equal(resSurvived.status, 200);
  const bodySurvived = (await resSurvived.json()) as {
    finalState: { stationStatus: string; collapseRootCause: string | null; turn: number };
    collapseAutopsy: { rootCause: string | null; failureTurn: number | null };
    turnReceipts: unknown[];
  };
  assert.equal(bodySurvived.finalState.stationStatus, "SURVIVED");
  assert.equal(bodySurvived.finalState.collapseRootCause, null);
  assert.equal(bodySurvived.finalState.turn, 14);
  assert.equal(bodySurvived.collapseAutopsy.rootCause, null);
  assert.equal(bodySurvived.collapseAutopsy.failureTurn, null);
  assert.equal(bodySurvived.turnReceipts.length, 14);
});

test("Ticket 03.3: GET /api/verify returns HTTP 200 with PASS JudgeVerificationReport", async () => {
  const res = await verifyGet();
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    verdict: string;
    tracks: string[];
    pbtSuite: { passed: boolean; witnessFloorsPassed: boolean };
  };
  assert.equal(body.verdict, "PASS");
  assert.deepEqual(body.tracks, ["games", "nfts"]);
  assert.equal(body.pbtSuite.passed, true);
  assert.equal(body.pbtSuite.witnessFloorsPassed, true);
});

test("Ticket 03.5 (Failure F5): Bilingual README.md and README.zh-TW.md document Do X See Y judge steps, tracks [games, nfts], and Q-015 GhostShift cross-disclosure", () => {
  const readmeEn = fs.readFileSync(
    path.resolve(process.cwd(), "README.md"),
    "utf8",
  );
  const readmeZh = fs.readFileSync(
    path.resolve(process.cwd(), "README.zh-TW.md"),
    "utf8",
  );

  for (const doc of [readmeEn, readmeZh]) {
    assert.equal(doc.includes("npm run verify:judge"), true);
    assert.equal(doc.includes("games"), true);
    assert.equal(doc.includes("nfts"), true);
    assert.equal(doc.includes("GhostShift"), true);
    assert.equal(doc.includes("https://github.com/GGGODLIN/near-ghost-shift"), true);
    assert.equal(doc.includes("Q-015"), true);
    assert.equal(doc.includes("NEP-171"), true);
    assert.equal(doc.includes("NEP-366"), true);
  }
});
