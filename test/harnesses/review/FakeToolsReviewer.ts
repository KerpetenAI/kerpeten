import { Harness } from "@kerpetensh/harness-kit";
import { ReviewerHarness } from "../../../src/harnesses/review/ReviewerHarness.ts";
import { FakeReadFileTool } from "../FakeReadFileTool.ts";

@Harness({ name: "reviewer-test", tools: [FakeReadFileTool], permissions: [] })
export class FakeToolsReviewer extends ReviewerHarness {}
