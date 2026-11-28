import { describe, expect, test } from "bun:test";
import { GitHubWriteAnswer } from "../../../src/capability/platform/GitHubWriteAnswer.ts";
import { RemoteProject } from "../../../src/capability/platform/RemoteProject.ts";
import type { PlatformRead } from "../../../src/capability/platform/types/platform.ts";
import { GITHUB_ORIGIN } from "./platform-utils.ts";

const project = RemoteProject.parse(GITHUB_ORIGIN);

const AGAIN = "run again: what is already written is not written a second time";

/** A call of gh that ended with `exitCode`, having printed `stdout` and written `stderr`. */
function exited(exitCode: number, stdout: unknown, stderr = ""): PlatformRead {
  const text = typeof stdout === "string" ? stdout : JSON.stringify(stdout);

  return { kind: "exited", exitCode, stdout: Buffer.from(text), stderr };
}

/** What gh gives for a request GitHub refused with HTTP 422 and the error body `body`. */
function invalid(body: unknown, stderr = "gh: Unprocessable Entity (HTTP 422)\n"): PlatformRead {
  return exited(1, body, stderr);
}

function answer(read: PlatformRead) {
  return GitHubWriteAnswer.of(read, 12, project);
}

describe("GitHub write answer", () => {
  test("an answer with exit code 0 and an id is written", () => {
    expect(answer(exited(0, { id: 9001, state: "COMMENTED" }))).toEqual({ kind: "written", id: 9001 });
  });

  test("a 422 is invalid, with GitHub's message and errors as the reason, whatever form the errors have", () => {
    const texts = { message: "Unprocessable Entity", errors: ["Line could not be resolved", "Path is wrong"] };

    expect(answer(invalid(texts))).toEqual({
      kind: "invalid",
      reason: "Unprocessable Entity: Line could not be resolved: Path is wrong",
    });

    const objects = {
      message: "Validation Failed",
      errors: [{ resource: "PullRequestReviewComment", field: "line", message: "line must be part of the diff" }],
    };

    expect(answer(invalid(objects, "gh: Validation Failed (HTTP 422)\n"))).toEqual({
      kind: "invalid",
      reason: "Validation Failed: line must be part of the diff",
    });

    expect(answer(invalid({ message: "Validation Failed", errors: [{ code: "custom", field: "line" }] }))).toEqual({
      kind: "invalid",
      reason: 'Validation Failed: {"code":"custom","field":"line"}',
    });

    expect(answer(invalid({ message: "Unprocessable Entity", errors: "one text" }))).toEqual({
      kind: "invalid",
      reason: "Unprocessable Entity: one text",
    });
  });

  test("a 422 is known by the status of the body when the line of gh does not name it, and by the line when the body cannot be read", () => {
    const body = { message: "Unprocessable Entity", errors: "Line could not be resolved", status: "422" };

    expect(answer(exited(1, body, "gh: Line could not be resolved (Unprocessable Entity)\n"))).toEqual({
      kind: "invalid",
      reason: "Unprocessable Entity: Line could not be resolved",
    });

    expect(answer(invalid("<html>no JSON</html>"))).toEqual({
      kind: "invalid",
      reason: "gh: Unprocessable Entity (HTTP 422)",
    });
  });

  test("a 422 about a pending review is failed, with what to do and GitHub's text, never invalid", () => {
    const pending = {
      message: "Unprocessable Entity",
      errors: ["User can only have one pending review per pull request"],
    };

    expect(answer(invalid(pending))).toEqual({
      kind: "failed",
      message:
        "not written: your account has a review on this pull request that is not submitted yet, and GitHub takes no other review beside it: submit or delete that review on the page of the pull request and run again (GitHub answered: Unprocessable Entity: User can only have one pending review per pull request)",
    });
  });

  test("GitHub's text is outside data: it is brought to one line without control characters and cut", () => {
    const result = answer(invalid({ message: `Bad\n\u001b[31mred\u0007 ${"x".repeat(2000)}` }));

    expect(result.kind).toBe("invalid");

    const reason = result.kind === "invalid" ? result.reason : "";

    expect(reason).toStartWith("Bad �[31mred� xxx");
    expect(reason.length).toBe(GitHubWriteAnswer.MAX_TEXT);
  });

  test("any other error is failed and says that nothing was written: a server error, a missing sign-in, a 403", () => {
    expect(answer(exited(1, { message: "Server Error" }, "gh: Server Error (HTTP 500)\n"))).toEqual({
      kind: "failed",
      message: "not written: gh api failed (exit 1): gh: Server Error (HTTP 500)",
    });

    expect(answer(exited(4, "", "gh: To get started with GitHub CLI, please run: gh auth login\n"))).toEqual({
      kind: "failed",
      message:
        "not written: gh is not signed in to github.com: run `gh auth login --hostname github.com` and run again",
    });

    expect(answer(exited(1, { message: "Bad credentials" }, "gh: Bad credentials (HTTP 401)\n")).kind).toBe("failed");

    expect(
      answer(exited(1, { message: "Resource not accessible" }, "gh: Resource not accessible (HTTP 403)\n")),
    ).toEqual({
      kind: "failed",
      message: "not written: gh api failed (exit 1): gh: Resource not accessible (HTTP 403)",
    });
  });

  test("a 404 says that the pull request or the comment is gone or the account may not write", () => {
    expect(answer(exited(1, { message: "Not Found", status: "404" }, "gh: Not Found (HTTP 404)\n"))).toEqual({
      kind: "failed",
      message:
        "not written: GitHub did not find what the write is for (HTTP 404): pull request 12 or the comment was removed, or the account gh is signed in to github.com with may not write to Acme/Shop",
    });
  });

  test("a call stopped at a limit, and an answer without an id, leave it unknown whether GitHub wrote, and say so", () => {
    expect(answer({ kind: "timed_out", stdout: Buffer.from(""), ms: 120_000 })).toEqual({
      kind: "failed",
      message: `it is not known whether GitHub wrote it: gh did not finish within 120 seconds; ${AGAIN}`,
    });

    expect(answer({ kind: "too_large", stdout: Buffer.from(""), bytes: 20_000_000 })).toEqual({
      kind: "failed",
      message: `it is not known whether GitHub wrote it: gh printed more than 20000000 bytes; ${AGAIN}`,
    });

    for (const stdout of ["", "not JSON", { id: "x" }, []]) {
      expect(answer(exited(0, stdout))).toEqual({
        kind: "failed",
        message: `it is not known whether GitHub wrote it: gh ended without an error, but its answer does not name what GitHub made; ${AGAIN}`,
      });
    }
  });
});
