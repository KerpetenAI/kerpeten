import { PermissionGroupSet } from "@kerpetensh/harness-kit";

export class PermissionGroups {
  public static readonly SET = new PermissionGroupSet({ read: ["repo:read", "repo:search"] });
}
