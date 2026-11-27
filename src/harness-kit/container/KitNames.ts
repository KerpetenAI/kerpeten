/**
 * The names under which the kit's components inject the kit's two values. `HarnessApplication` registers them from its
 * options; a program does not register them itself.
 */
export enum KitNames {
  IO = "harness-kit:io",
  PERMISSION_GROUPS = "harness-kit:permission-groups",
}
