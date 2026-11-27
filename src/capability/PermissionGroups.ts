import { PermissionGroupSet } from "../harness-kit/index.ts";

export class PermissionGroups {
  public static readonly SET = new PermissionGroupSet({ read: ["repo:read", "repo:search"] });
}
