import { describe, expect, test } from "bun:test";
import { PlatformChoiceError } from "../../../src/capability/platform/PlatformChoiceError.ts";
import { PlatformError } from "../../../src/capability/platform/PlatformError.ts";
import type { PlatformFailure } from "../../../src/capability/platform/types/platform.ts";
import { ReviewInputError } from "../../../src/harnesses/review/ReviewInputError.ts";
import { mergeRequestReadError } from "../../../src/workflow/review/review-utils.ts";

describe("the error of a merge request that cannot be read", () => {
  test("what the user can put right is a wrong input, with the flag before the message", () => {
    const kinds: PlatformFailure[] = ["cli_missing", "signed_out", "not_found", "no_repository"];

    for (const kind of kinds) {
      const error = mergeRequestReadError(12, new PlatformError(kind, "the reason"));

      expect(error).toBeInstanceOf(ReviewInputError);
      expect(error).toHaveProperty("message", "--mr 12: the reason");
    }

    const unknown = mergeRequestReadError(7, new PlatformChoiceError("no origin remote"));

    expect(unknown).toBeInstanceOf(ReviewInputError);
    expect(unknown).toHaveProperty("message", "--mr 7: no origin remote");
  });

  test("a read the platform failed at stays a platform error, with the flag before the message", () => {
    const error = mergeRequestReadError(12, new PlatformError("failed", "gh api failed (exit 1): HTTP 502"));

    expect(error).toBeInstanceOf(PlatformError);
    expect(error).not.toBeInstanceOf(ReviewInputError);
    expect(error).toMatchObject({ kind: "failed", message: "--mr 12: gh api failed (exit 1): HTTP 502" });
  });

  test("any other error is given back as it is", () => {
    const other = new TypeError("a bug");

    expect(mergeRequestReadError(12, other)).toBe(other);
    expect(mergeRequestReadError(12, "text")).toBe("text");
  });
});
