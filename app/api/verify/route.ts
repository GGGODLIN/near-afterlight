import { runJudgeAudit } from "../../../src/verifier/judge-audit-runner.ts";

export async function GET(): Promise<Response> {
  const report = runJudgeAudit();
  return Response.json(report, { status: 200 });
}
