export interface DeclaredGroups {
  readonly declared: readonly (readonly [string, readonly string[]])[];
}

/** One `@Use` of a harness's tool, with the permission of its capability. */
export interface PermissionNeed {
  readonly harness: string;
  readonly tool: string;
  readonly capability: string;
  readonly permission: string;
  readonly required: boolean;
}

/** An optional capability that the run's permission group does not give; its field reads `undefined`. */
export interface OptionalGap {
  readonly harness: string;
  readonly tool: string;
  readonly capability: string;
  readonly permission: string;
  readonly group: string;
}
