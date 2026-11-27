/** What the flow fixtures did, in order. */
export class FlowLog {
  public static readonly events: string[] = [];

  public static clear(): void {
    FlowLog.events.length = 0;
  }
}
