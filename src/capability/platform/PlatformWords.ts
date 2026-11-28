import type { PlatformKind } from "./types/platform.ts";

/**
 * The words of one platform for what the review calls a merge request: its name there, and the command of the
 * platform's CLI that checks one out. A message for the user takes its words from here, so it reads as the platform
 * the user is on does.
 */
export class PlatformWords {
  private static readonly ALL: Readonly<Record<PlatformKind, PlatformWords>> = {
    github: new PlatformWords("pull request", "gh pr checkout"),
    gitlab: new PlatformWords("merge request", "glab mr checkout"),
  };

  /** The platform's name for a merge request, in lowercase. */
  public readonly noun: string;

  private readonly checkout: string;

  private constructor(noun: string, checkout: string) {
    this.noun = noun;
    this.checkout = checkout;
  }

  public static of(kind: PlatformKind): PlatformWords {
    return PlatformWords.ALL[kind];
  }

  /** The command that puts the working copy at the last commit of merge request `number`. */
  public checkoutCommand(number: number): string {
    return `${this.checkout} ${number}`;
  }
}
