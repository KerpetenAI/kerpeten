import type { ChatGptPlan } from "../../../capability/chatgpt/ChatGptPlan.ts";
import type { KerpetenConfig } from "../../../capability/config/types/config.ts";
import type { JudgedFinding } from "../../../harnesses/review/types/review.ts";
import type { ProviderLlm, UsageEntry } from "../../../harnesses/types/harnesses.ts";

/** What the `review` command line asks for: the input of the review command workflow. */
export interface ReviewFlags {
  readonly dryRun: boolean;
  readonly full: boolean;
  readonly base?: string;
  readonly contextFile?: string;
  readonly extraContext?: string;
  readonly group: string;
  readonly json: boolean;
}

export interface ReviewJson {
  readonly findings: readonly JudgedFinding[];
  readonly usage: readonly UsageEntry[];
}

/** A review that is ready to run: its repository, its configuration and both model clients. */
export interface PreparedReview {
  readonly repo: string;
  readonly config: KerpetenConfig;
  readonly configHash: string;
  readonly reviewerClient: ProviderLlm;
  readonly judgeClient: ProviderLlm;
  readonly plan: ChatGptPlan | undefined;
  readonly pathEnv: string;
}

export type ReviewPreparation =
  | { readonly ok: true; readonly review: PreparedReview }
  | { readonly ok: false; readonly problems: readonly string[] };
