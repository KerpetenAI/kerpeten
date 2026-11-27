import type { Usage } from "../api/types/api.generated.ts";
import type { UsageTotals } from "../harness-kit/index.ts";
import type { Deadlines, RunProvider, UsageEntry } from "./types/harnesses.ts";

const FINALIZE_RESERVE_MS = 5 * 60 * 1000;

export function deadlines(start: number, minutes: number): Deadlines {
  const total = minutes * 60 * 1000;

  const reserve = Math.min(FINALIZE_RESERVE_MS, Math.floor(total / 4));

  return { stepDeadline: start + total - reserve, finalizeDeadline: start + total };
}

export function usageEntry(role: Usage["role"], provider: RunProvider, model: string, totals: UsageTotals): UsageEntry {
  return {
    role,
    provider,
    model,
    input_tokens: totals.inputTokens,
    output_tokens: totals.outputTokens,
    ...(totals.cacheReadTokens === undefined ? {} : { cache_read_tokens: totals.cacheReadTokens }),
    ...(totals.cacheWriteTokens === undefined ? {} : { cache_write_tokens: totals.cacheWriteTokens }),
    calls: totals.calls,
  };
}
