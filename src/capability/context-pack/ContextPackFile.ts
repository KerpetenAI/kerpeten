import { Capability, CapabilityBase } from "@kerpetensh/harness-kit";
import { readJson } from "../../files/files-utils.ts";
import { issueMessages } from "../../validation/validation-utils.ts";
import { contextPackSchema } from "./schemas/context-pack-schema.ts";
import type { ContextFileResult } from "./types/context-pack.ts";

@Capability({
  name: "context-pack-file",
  description: "Reads the JSON file of already known findings given with --context-file and checks its shape.",
})
export class ContextPackFile extends CapabilityBase {
  public static readonly MAX_CONTEXT_FILE_BYTES = 5_000_000;

  public static parse(value: unknown): ContextFileResult {
    const result = contextPackSchema.safeParse(value);

    if (result.success) return { ok: true, pack: result.data };

    const detail = issueMessages(result.error.issues.slice(0, 5), value).join("; ");

    return { ok: false, error: `not a context pack: ${detail}` };
  }

  public read(path: string): ContextFileResult {
    const file = readJson(path, ContextPackFile.MAX_CONTEXT_FILE_BYTES);

    if (!file.ok) return { ok: false, error: file.error };

    const result = ContextPackFile.parse(file.value);

    return result.ok ? result : { ok: false, error: `${path}: ${result.error}` };
  }
}
