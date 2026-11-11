import { runLiveJudgeAudit } from "./judge-audit-runner.ts";

const report = await runLiveJudgeAudit();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict !== "PASS") {
  process.exitCode = 1;
}
