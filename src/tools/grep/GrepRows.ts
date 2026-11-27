import { join } from "node:path";
import { RepoLimits } from "../../capability/repo/RepoLimits.ts";
import type { Jail } from "../../capability/repo/types/repo.ts";
import { exists } from "../../files/files-utils.ts";
import type { GrepMatch } from "./types/grep.ts";

export class GrepRows {
  private static readonly RECORD = /^([0-9]+):/;

  public readonly matches: GrepMatch[] = [];
  private readonly jail: Jail;
  private readonly decoder = new TextDecoder();
  private readonly names = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  private readonly accepted = new Map<string, boolean>();
  private pending: Uint8Array[] = [];
  private stray: (string | undefined)[] = [];

  public constructor(jail: Jail) {
    this.jail = jail;
  }

  public get full(): boolean {
    return this.matches.length > RepoLimits.GREP_MAX_MATCHES;
  }

  public push(chunk: Uint8Array): void {
    let start = 0;

    for (let newline = chunk.indexOf(10); newline >= 0 && !this.full; newline = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, newline);

      start = newline + 1;

      if (this.pending.length === 0) {
        this.record(piece);
      } else {
        this.pending.push(piece);
        this.record(Buffer.concat(this.pending));
        this.pending = [];
      }
    }

    if (start < chunk.length && !this.full) this.pending.push(chunk.slice(start));
  }

  public end(): void {
    if (this.pending.length > 0) this.record(Buffer.concat(this.pending));

    this.pending = [];
  }

  private record(bytes: Uint8Array): void {
    const nul = bytes.indexOf(0);

    if (nul < 0) {
      this.stray.push(this.name(bytes));

      return;
    }

    const stray = this.stray;

    this.stray = [];

    const rest = this.decoder.decode(bytes.subarray(nul + 1));
    const record = GrepRows.RECORD.exec(rest);
    const raw = this.name(bytes.subarray(0, nul));

    if (record === null || raw === undefined) return;

    const path = raw.startsWith("./") ? raw.slice(2) : raw;

    if (!this.accept(path) || this.splitName(stray, raw)) return;

    const text = rest.slice(record[0].length);

    this.matches.push({ path, line: Number(record[1]), text: text.endsWith("\r") ? text.slice(0, -1) : text });
  }

  private accept(path: string): boolean {
    let accepted = this.accepted.get(path);

    if (accepted === undefined) {
      accepted = this.jail.regularTrackedFile(path);
      this.accepted.set(path, accepted);
    }

    return accepted;
  }

  private name(bytes: Uint8Array): string | undefined {
    try {
      return this.names.decode(bytes);
    } catch {
      return undefined;
    }
  }

  private splitName(stray: readonly (string | undefined)[], raw: string): boolean {
    let name = raw;

    for (let i = stray.length - 1; i >= 0; i--) {
      const line = stray[i];

      if (line === undefined) return true;

      name = `${line}\n${name}`;

      if (exists(join(this.jail.root, name))) return true;
    }

    return false;
  }
}
