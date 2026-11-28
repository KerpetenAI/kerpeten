import { Harness } from "@kerpetensh/harness-kit";
import { JudgeHarness } from "../../../src/harnesses/judge/JudgeHarness.ts";
import { FakeReadFileTool } from "../FakeReadFileTool.ts";

@Harness({ name: "judge-test", tools: [FakeReadFileTool], permissions: [] })
export class FakeToolsJudge extends JudgeHarness {}
