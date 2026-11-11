import { runLiveJudgeAudit } from "../../../src/verifier/judge-audit-runner.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await runLiveJudgeAudit();
  return Response.json(report, { status: 200 });
}
