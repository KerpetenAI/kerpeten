import type { ChatGptPlan } from "../../../capability/chatgpt/ChatGptPlan.ts";
import type { KerpetenConfig } from "../../../capability/config/types/config.ts";
import type { MergeRequestState, PlatformKind } from "../../../capability/platform/types/platform.ts";
import type { JudgedFinding } from "../../../harnesses/review/types/review.ts";
import type { ProviderLlm, UsageEntry } from "../../../harnesses/types/harnesses.ts";

/** What the `review` command line asks for: the input of the review command workflow. */
export interface ReviewFlags {
  readonly dryRun: boolean;
  readonly full: boolean;
  readonly base?: string;
  readonly mr?: number;
  readonly contextFile?: string;
  readonly extraContext?: string;
  readonly group: string;
  readonly json: boolean;
}

/** The merge request of a review in the JSON output: whose review of what it is. */
export interface MergeRequestJson {
  readonly tenant: string;
  readonly platform: { readonly kind: PlatformKind; readonly host: string };
  readonly project: { readonly id: string };
  readonly mr: number;
  readonly title: string;
  readonly state: MergeRequestState;
  readonly head_sha: string;
  readonly base_sha: string;
}

export interface ReviewJson {
  readonly merge_request?: MergeRequestJson;
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
