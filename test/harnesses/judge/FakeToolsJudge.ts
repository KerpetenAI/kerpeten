import { Harness } from "../../../src/harness-kit/index.ts";
import { JudgeHarness } from "../../../src/harnesses/judge/JudgeHarness.ts";
import { FakeReadFileTool } from "../FakeReadFileTool.ts";

@Harness({ name: "judge-test", tools: [FakeReadFileTool], permissions: [] })
export class FakeToolsJudge extends JudgeHarness {}
