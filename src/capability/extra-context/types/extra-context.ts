export type ExtraContextResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };
