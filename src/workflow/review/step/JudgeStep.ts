import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { type After, FlowStep, FlowStepBase } from "../../../harness-kit/index.ts";
import { JudgePool } from "../../../harnesses/judge/JudgePool.ts";
import type { CandidateStep } from "./CandidateStep.ts";

/** Judges every kept finding in the judge pool; with no kept finding no judge runs and `judged` is undefined. */
@FlowStep({
  name: "judge",
  description: "Has the judge model check and label every kept finding; with no kept finding no judge runs.",
})
export class JudgeStep extends FlowStepBase {
  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(JudgePool)
  private readonly judges!: JudgePool;

  public async execute(state: After<typeof CandidateStep>) {
    const { config, judgeClient, log, candidates, change } = state;

    if (candidates.kept.length === 0) return { judged: undefined };

    const judged = await this.judges.judge(
      {
        findings: candidates.kept,
        patch: change.patch,
        commentLanguage: config.comment_language,
        promptVersion: change.judgePromptVersion,
      },
      {
        llm: judgeClient,
        limits: {
          parallel: config.limits.max_judge_parallel,
          ...(config.limits.max_judge_tool_calls === undefined
            ? {}
            : { maxToolCalls: config.limits.max_judge_tool_calls }),
          durationMinutes: config.limits.max_judge_duration_minutes,
        },
        now: this.now,
        log,
      },
    );

    return { judged };
  }
}
