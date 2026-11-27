import { JudgeHarness } from "./judge/JudgeHarness.ts";
import { ReviewerHarness } from "./review/ReviewerHarness.ts";

export class Harnesses {
  public static readonly ALL = [ReviewerHarness, JudgeHarness] as const;
}
