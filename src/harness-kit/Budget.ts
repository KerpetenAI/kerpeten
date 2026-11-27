import type { BudgetLimits, PartialReason } from "./types/harness.ts";

export class Budget {
  public readonly limits: BudgetLimits;
  private readonly now: () => number;
  private usedToolCalls = 0;

  public constructor(limits: BudgetLimits, now: () => number) {
    for (const [name, value] of Object.entries(limits)) {
      if (value === undefined) continue;

      if (!Number.isFinite(value) || value < 0) throw new Error(`budget ${name} must be a finite number >= 0`);
    }

    if (limits.finalizeDeadline < limits.stepDeadline)
      throw new Error("the finalize deadline is before the step deadline");

    this.limits = limits;
    this.now = now;
  }

  public get toolCalls(): number {
    return this.usedToolCalls;
  }

  public stepMs(): number {
    return Math.max(0, this.limits.stepDeadline - this.now());
  }

  public finalizeMs(): number {
    return Math.max(0, this.limits.finalizeDeadline - this.now());
  }

  public beforeStep(): PartialReason | undefined {
    if (this.stepMs() <= 0) return "time_budget";

    return undefined;
  }

  public takeToolCall(): PartialReason | undefined {
    const { maxToolCalls } = this.limits;

    if (this.stepMs() <= 0) return "time_budget";
    if (maxToolCalls !== undefined && this.usedToolCalls >= maxToolCalls) return "tool_call_budget";

    this.usedToolCalls++;

    return undefined;
  }
}
