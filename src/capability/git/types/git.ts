import type { ProcessResult } from "../../../harness-kit/index.ts";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export interface ChangedFile {
  readonly status: ChangeStatus;
  readonly path: string;
  readonly oldPath?: string;
}

export interface DiffResult {
  readonly files: readonly ChangedFile[];
  readonly patch: string;
}

export type GitResult = ProcessResult;

export type BlobResult =
  | { readonly kind: "blob"; readonly bytes: Buffer }
  | { readonly kind: "missing" }
  | { readonly kind: "too_large" };
