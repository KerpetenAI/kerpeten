import { dirname, isAbsolute, join } from "node:path";
import type { Env } from "../../app/types/app.ts";
import { exists } from "../../files/files-utils.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import type { PkcePair, StoredTokens, TokenResponse } from "./types/chatgpt.ts";

const MS_PER_SECOND = 1000;

const SECONDS_LIMIT = 1e12;

const DEFAULT_LIFETIME_S = 3600;

export function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function randomValue(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkcePair(): Promise<PkcePair> {
  const verifier = randomValue();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(Buffer.from(text, "base64url"));
}

export function jsonPart(text: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(text)));
}

/**
 * The path of `auth.json`: under `$XDG_CONFIG_HOME/kerpeten`, or `~/.config/kerpeten` when that is not set. A path
 * inside a git work tree is refused, so that a repository, for example through its `.env`, cannot have the sign-in
 * saved where it can be committed.
 */
export function authFilePath(env: Env): string {
  const path = configFilePath(env);
  const repo = gitWorkTree(dirname(path));

  if (repo !== undefined) {
    throw new ChatGptAuthError(
      `the sign-in file ${path} is inside the git repository ${repo}, where it could be committed; set XDG_CONFIG_HOME to an absolute directory outside any git repository (a .env file of the repository you run Kerpeten in can set it)`,
    );
  }

  return path;
}

function configFilePath(env: Env): string {
  const xdg = env.XDG_CONFIG_HOME;

  if (xdg !== undefined && xdg !== "" && isAbsolute(xdg)) return join(xdg, "kerpeten", "auth.json");

  const home = env.HOME;

  if (home === undefined || home === "" || !isAbsolute(home)) {
    throw new ChatGptAuthError(
      "cannot find the config directory: neither XDG_CONFIG_HOME nor HOME is an absolute path",
    );
  }

  return join(home, ".config", "kerpeten", "auth.json");
}

function gitWorkTree(dir: string): string | undefined {
  const parent = dirname(dir);

  if (exists(join(dir, ".git"))) return dir;

  return parent === dir ? undefined : gitWorkTree(parent);
}

export function epochMs(value: number | string | undefined): number | undefined {
  if (value === undefined) return undefined;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return undefined;

    return Math.round(value < SECONDS_LIMIT ? value * MS_PER_SECOND : value);
  }

  const parsed = Date.parse(value);

  return Number.isNaN(parsed) ? undefined : parsed;
}

export function scopesOf(scope: string | undefined): string[] {
  return (scope ?? "").split(/\s+/u).filter((entry) => entry !== "");
}

/** The tokens to save from a token response; a refresh that sends no new refresh token keeps the old one. */
export function storedTokens(tokens: TokenResponse, previous: StoredTokens | undefined, now: number): StoredTokens {
  const refresh = tokens.refresh_token ?? previous?.refresh_token;

  if (refresh === undefined) throw new ChatGptAuthError("the ChatGPT sign-in returned no refresh token");

  const earliest = epochMs(tokens.earliest_refresh_at);

  return {
    access_token: tokens.access_token,
    refresh_token: refresh,
    token_type: tokens.token_type ?? "Bearer",
    scopes: tokens.scope === undefined ? (previous?.scopes ?? []) : scopesOf(tokens.scope),
    expires_at: now + Math.round((tokens.expires_in ?? DEFAULT_LIFETIME_S) * MS_PER_SECOND),
    ...(earliest === undefined ? {} : { earliest_refresh_at: earliest }),
    saved_at: new Date(now).toISOString(),
  };
}
