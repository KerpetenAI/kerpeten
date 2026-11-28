import type { ProcessResult } from "@kerpetensh/harness-kit";

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

/** One file's part of a patch: the path the patch gives the file, and the text from its `diff --git` line on. */
export interface PatchSection {
  readonly path: string;
  readonly text: string;
}

export type GitResult = ProcessResult;

export type BlobResult =
  | { readonly kind: "blob"; readonly bytes: Buffer }
  | { readonly kind: "missing" }
  | { readonly kind: "too_large" };
