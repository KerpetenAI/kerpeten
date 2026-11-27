import type { PermissionGrant } from "./capability/types/capability.ts";
import { PermissionGroupError } from "./PermissionGroupError.ts";
import type { PermissionGroupMap } from "./types/harness.ts";

export class PermissionGroupSet {
  public static readonly ALL = "all";

  private readonly groups: PermissionGroupMap;

  public constructor(groups: PermissionGroupMap) {
    if (Object.hasOwn(groups, PermissionGroupSet.ALL))
      throw new PermissionGroupError(`the permission group "${PermissionGroupSet.ALL}" is built in`);

    this.groups = groups;
  }

  public get names(): readonly string[] {
    return [PermissionGroupSet.ALL, ...Object.keys(this.groups)];
  }

  public get declared(): readonly (readonly [string, readonly string[]])[] {
    return Object.entries(this.groups);
  }

  public check(name: string): void {
    if (name !== PermissionGroupSet.ALL && !Object.hasOwn(this.groups, name)) {
      throw new PermissionGroupError(
        `unknown permission group ${JSON.stringify(name)}; known groups: ${this.names.join(", ")}`,
      );
    }
  }

  public grant(name: string): PermissionGrant {
    this.check(name);

    if (name === PermissionGroupSet.ALL) return { group: name, every: true };

    return { group: name, every: false, permissions: [...(this.groups[name] ?? [])] };
  }
}
