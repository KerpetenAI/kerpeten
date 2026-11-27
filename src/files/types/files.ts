export type TextFileResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "missing" | "unreadable" | "not_file" | "too_large" | "not_utf8";
      readonly error: string;
    };

export type JsonFileResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

export interface ErrnoLike {
  readonly code?: unknown;
}
