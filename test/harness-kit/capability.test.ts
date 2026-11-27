import { describe, expect, test } from "bun:test";
import { Capability, capabilitySpec } from "../../src/harness-kit/index.ts";
import { LocalCapability } from "./LocalCapability.ts";
import { SearchCapability } from "./SearchCapability.ts";

describe("@Capability", () => {
  test("records the permission a capability declares and leaves it out when none is declared", () => {
    expect(capabilitySpec(SearchCapability).permission).toBe("repo:search");
    expect(new SearchCapability().capabilityName).toBe("search");
    expect(capabilitySpec(LocalCapability).permission).toBeUndefined();
  });

  test("refuses a permission that is not lowercase words joined by colons", () => {
    for (const permission of [
      "",
      " ",
      "repo read",
      "Repo:read",
      "repo:",
      ":read",
      "repo::read",
      "repo:read,",
      "all\n",
    ]) {
      expect(() => Capability({ name: "bad", description: "", permission })).toThrow(
        `capability bad declares the permission ${JSON.stringify(permission)}; a permission is lowercase words joined by colons, like repo:read`,
      );
    }

    const wrongType = { name: "bad", description: "", permission: 1 } as unknown as Parameters<typeof Capability>[0];

    expect(() => Capability(wrongType)).toThrow("capability bad declares the permission 1;");

    for (const permission of ["repo:read", "probe:run", "skills", "repo-files:read-only", "a1:b2"]) {
      expect(() => Capability({ name: "good", description: "", permission })).not.toThrow();
    }
  });
});
