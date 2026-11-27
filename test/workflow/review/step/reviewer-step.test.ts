import { afterEach, describe, expect, test } from "bun:test";
import { PermissionGroups } from "../../../../src/capability/PermissionGroups.ts";
import { ReviewerStep } from "../../../../src/workflow/review/step/ReviewerStep.ts";
import { runStep } from "../../../app/app-utils.ts";
import { mockClient, promptText } from "../../../harness-kit/harness-kit-utils.ts";
import { capturingLogger } from "../../../harnesses/harnesses-utils.ts";
import { changed, cleanDirs, config, good, repoWithBranch, reviewComponent } from "../review-utils.ts";

afterEach(cleanDirs);

describe("reviewer flow step", () => {
  test("adds the reviewer's run on the change, with the tools of the permission group", async () => {
    const { repo } = repoWithBranch();
    const state = await changed(repo);
    const mock = mockClient([{ text: "done" }, { text: JSON.stringify({ findings: [good] }) }]);
    const captured = capturingLogger();

    const added = await runStep(
      await reviewComponent(ReviewerStep),
      { ...state, reviewerClient: mock.client, log: captured.log },
      { grant: PermissionGroups.SET.grant("read") },
    );

    expect(Object.keys(added)).toEqual(["review"]);
    expect(added.review).toMatchObject({ completed: true, findings: [good], toolCalls: 0 });
    expect(mock.calls[0]?.tools?.map((tool) => tool.name)).toEqual(["list_dir", "read_file", "grep", "glob"]);
    expect(promptText(mock.calls[0])).toContain("It divides.");

    expect(captured.lines.filter((line) => line.message === "permission group").map((line) => line.fields)).toEqual([
      { group: "read", permissions: "repo:read, repo:search" },
    ]);
  });

  test("the tool limit of the config makes the run partial", async () => {
    const { repo } = repoWithBranch();
    const state = await changed(repo);

    const mock = mockClient([
      {
        toolCalls: [
          { name: "read_file", input: { path: "src/a.ts" } },
          { name: "list_dir", input: { path: "." } },
        ],
      },
      { text: JSON.stringify({ findings: [] }) },
    ]);

    const added = await runStep(await reviewComponent(ReviewerStep), {
      ...state,
      config: config("limits: { max_tool_calls: 1 }\n"),
      reviewerClient: mock.client,
      log: capturingLogger().log,
    });

    expect(added.review).toMatchObject({ partialReason: "tool_call_budget", toolCalls: 1 });
  });
});
