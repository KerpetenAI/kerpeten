/** The component kinds the kit registers its classes under. */
export class KitKinds {
  /** A capability built once for the program. A capability built per run has the kind `RUN` instead. */
  public static readonly CAPABILITY = Symbol("harness-kit:capability");

  public static readonly CLI = Symbol("harness-kit:cli");

  public static readonly HARNESS = Symbol("harness-kit:harness");

  /**
   * A run component: a capability with `scope: "run"` or a class marked with `@RunService`, built once per run.
   * Nothing enumerates this kind with `resolveAll`, which would build an instance of each outside every run.
   */
  public static readonly RUN = Symbol("harness-kit:run");

  public static readonly FLOW_STEP = Symbol("harness-kit:flow-step");

  public static readonly TOOL = Symbol("harness-kit:tool");

  public static readonly WORKFLOW = Symbol("harness-kit:workflow");
}
