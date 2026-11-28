import { Harness } from "@kerpetensh/harness-kit";
import { ReviewerHarness } from "../../src/harnesses/review/ReviewerHarness.ts";
import { GrepTool } from "../../src/tools/grep/GrepTool.ts";

@Harness({ name: "broken", tools: [GrepTool], permissions: ["repo:read", "repo:write"] })
export class BrokenReviewer extends ReviewerHarness {}
