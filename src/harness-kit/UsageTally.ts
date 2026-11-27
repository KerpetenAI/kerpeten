import type { UsageTotals } from "./types/harness.ts";
import type { CallUsage } from "./types/llm.ts";

export class UsageTally {
  private readonly records: CallUsage[] = [];

  public constructor(calls: readonly CallUsage[] = []) {
    this.add(calls);
  }

  public add(calls: readonly CallUsage[]): void {
    this.records.push(...calls);
  }

  public get calls(): readonly CallUsage[] {
    return this.records;
  }

  public get totals(): UsageTotals {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens: number | undefined;
    let cacheWriteTokens: number | undefined;
    let unknownCounts = 0;

    for (const call of this.records) {
      if (call.inputTokens === undefined || call.outputTokens === undefined) unknownCounts++;

      inputTokens += call.inputTokens ?? 0;
      outputTokens += call.outputTokens ?? 0;

      if (call.cacheReadTokens !== undefined) cacheReadTokens = (cacheReadTokens ?? 0) + call.cacheReadTokens;
      if (call.cacheWriteTokens !== undefined) cacheWriteTokens = (cacheWriteTokens ?? 0) + call.cacheWriteTokens;
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, calls: this.records.length, unknownCounts };
  }
}
