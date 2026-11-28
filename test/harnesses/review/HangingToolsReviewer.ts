import { Harness } from "@kerpetensh/harness-kit";
import { ReviewerHarness } from "../../../src/harnesses/review/ReviewerHarness.ts";
import { HangingTool } from "../HangingTool.ts";

@Harness({ name: "reviewer-hanging-test", tools: [HangingTool], permissions: [] })
export class HangingToolsReviewer extends ReviewerHarness {}
