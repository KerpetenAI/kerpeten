import type { z } from "zod";
import type { listDirInput } from "../schemas/list-dir-schema.ts";

export type ListDirInput = z.infer<typeof listDirInput>;

export type EntryType = "file" | "dir" | "symlink" | "other";
