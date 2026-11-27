import { afterEach, describe, expect, test } from "bun:test";
import { JudgeStep } from "../../../../src/workflow/review/step/JudgeStep.ts";
import { runStep } from "../../../app/app-utils.ts";
import { FakeJudgeLlm } from "../../../harnesses/judge/FakeJudgeLlm.ts";
import { candidates, cleanDirs, good, labels, repoWithBranch, reviewComponent } from "../review-utils.ts";

afterEach(cleanDirs);

function judgeLlm(): FakeJudgeLlm {
  return new FakeJudgeLlm((context) => ({ name: FakeJudgeLlm.titleOf(context), labels }));
}

describe("judge flow step", () => {
  test("adds the judge's outcome for every kept finding in their order", async () => {
    const { repo } = repoWithBranch();
    const second = { ...good, title: "Second" };
    const judge = judgeLlm();

    const added = await runStep(await reviewComponent(JudgeStep), {
      ...(await candidates(repo, [good, second])),
      judgeClient: judge,
    });

    expect(added.judged?.outcomes).toEqual([{ labels }, { labels }]);
    expect(added.judged?.usage.role).toBe("judge");
    expect(judge.contexts.length).toBe(2);
  });

  test("no kept finding adds an undefined judge result and makes no judge call", async () => {
    const { repo } = repoWithBranch();
    const judge = judgeLlm();

    const added = await runStep(await reviewComponent(JudgeStep), {
      ...(await candidates(repo, [])),
      judgeClient: judge,
    });

    expect(added).toEqual({ judged: undefined });
    expect(judge.contexts.length).toBe(0);
  });
});
