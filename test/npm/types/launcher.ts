export type ResolvedBinary =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string };

/** What `npm/kerpeten.cjs` exports for its tests. */
export interface Launcher {
  resolveBinary(
    names: readonly string[],
    platform: string,
    arch: string,
    musl: boolean,
    resolve: (id: string) => string,
  ): ResolvedBinary;
  usesMusl(platform: string, readReport: () => unknown): boolean;
}
