import type { Class } from "@asenajs/ioc";
import type { PermissionGrant, Run } from "@kerpetensh/harness-kit";

/**
 * How `openRun` opens a test run: its grant, every permission when left out; the components of its container, the
 * CLI's when left out; and the ready instances it is given, as test doubles.
 */
export interface TestRunOptions {
  readonly grant?: PermissionGrant;
  readonly components?: readonly Class[];
  readonly give?: (run: Run) => void;
}
