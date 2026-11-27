import type { JailResult } from "../../capability/repo/types/repo.ts";

export type ResolvedPath = Extract<JailResult, { readonly ok: true }>;
