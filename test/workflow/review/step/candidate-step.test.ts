import { afterEach, describe, expect, test } from "bun:test";
import { CandidateStep } from "../../../../src/workflow/review/step/CandidateStep.ts";
import { runStep } from "../../../app/app-utils.ts";
import { changed, cleanDirs, good, repoWithBranch, reviewComponent, reviewerRun } from "../review-utils.ts";

afterEach(cleanDirs);

describe("candidate flow step", () => {
  test("adds the findings that point at real lines at HEAD and counts the dropped ones", async () => {
    const { repo } = repoWithBranch();
    const findings = [good, { ...good, file: "src/missing.ts" }, { ...good, start_line: 500, end_line: 501 }];
    const state = { ...(await changed(repo)), review: reviewerRun(findings) };

    const added = await runStep(await reviewComponent(CandidateStep), state);

    expect(added).toEqual({
      candidates: { kept: [{ ...good, file: "src/a.ts" }], dropped: { no_file: 1, line_outside: 1 }, clipped: 0 },
    });
  });
});
