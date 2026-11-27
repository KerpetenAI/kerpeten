import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { RepoJail } from "../../../../src/capability/repo/RepoJail.ts";
import { RunScope, WorkflowEnd } from "../../../../src/harness-kit/index.ts";
import { ChangeStep } from "../../../../src/workflow/review/step/ChangeStep.ts";
import { openRun, runStep } from "../../../app/app-utils.ts";
import { commit, tempRepo, write } from "../../../capability/git/git-utils.ts";
import { cleanDirs, dirs, repoWithBranch, reviewComponent, runValues } from "../review-utils.ts";

afterEach(() => {
  cleanDirs();
  mock.restore();
});

function step(): Promise<ChangeStep> {
  return reviewComponent(ChangeStep, () => 42);
}

describe("change flow step", () => {
  test("adds the change against the merge base", async () => {
    const { repo, base, head } = repoWithBranch();

    const added = await runStep(await step(), { repo, base: "main", pathEnv: "", ...runValues() });

    if (added instanceof WorkflowEnd) throw new Error("the change is not empty");

    expect(added.change).toEqual({
      baseSha: base,
      headSha: head,
      changedFiles: ["src/a.ts"],
      promptVersion: "v4",
      start: 42,
      patch: expect.stringContaining("x / y"),
      title: "feature",
      description: expect.stringContaining("It divides."),
      known: [],
      judgePromptVersion: "v4",
    });

    expect(Object.keys(added)).toEqual(["change"]);
  });

  test("leaves the repository jail to the first tool that takes it, which builds it over the files tracked at HEAD", async () => {
    const { repo } = repoWithBranch();
    const input = { repo, base: "main", pathEnv: "", ...runValues() };
    const run = await openRun(input);
    const built = spyOn(RepoJail.prototype, "build");
    const changeStep = await step();

    await run.prepare(changeStep);
    await RunScope.enter(run, () => changeStep.execute(input));

    expect(built).not.toHaveBeenCalled();
    expect((await run.ready(RepoJail)).files).toEqual(["README.md", "src/a.ts"]);
    expect(built).toHaveBeenCalledTimes(1);
  });

  test("an empty diff ends the review with an empty result", async () => {
    const repo = tempRepo("kerpeten-flow step-");

    dirs.push(repo);
    write(repo, { "a.ts": "1\n" });

    const head = commit(repo, "base");

    const added = await runStep(await step(), { repo, base: "main", pathEnv: "", ...runValues() });

    expect(added).toEqual(
      new WorkflowEnd({
        baseSha: head,
        headSha: head,
        changedFiles: [],
        dropped: {},
        clipped: 0,
        promptVersion: "v4",
        findings: [],
        partial: false,
        usage: [],
        toolCalls: 0,
        judgeToolCalls: 0,
      }),
    );
  });
});
