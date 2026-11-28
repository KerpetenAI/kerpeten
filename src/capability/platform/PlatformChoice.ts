import { RunService, RunValue, Use } from "../../harness-kit/index.ts";
import { terminalLine } from "../../text/text-utils.ts";
import { ConfigLoader } from "../config/ConfigLoader.ts";
import type { KerpetenConfig } from "../config/types/config.ts";
import { Git } from "../git/Git.ts";
import { GitHubPlatform } from "./GitHubPlatform.ts";
import { GitLabPlatform } from "./GitLabPlatform.ts";
import { PlatformChoiceError } from "./PlatformChoiceError.ts";
import type { Platform, PlatformKind } from "./types/platform.ts";

/**
 * The platform of the run's repository, chosen once per run and before any platform tool runs. The `platform` key of
 * the configuration names it. Without the key, the host of the `origin` remote decides: `github.com` is GitHub and
 * `gitlab.com` is GitLab. Any other host, and a repository without an `origin` remote, is a `PlatformChoiceError`
 * that says to set the key: the host name is not guessed from, and no tool is tried to see whether it answers.
 *
 * The URL of the remote is outside data and may hold a password, so only its host is read and nothing else of it is
 * shown.
 */
@RunService("kerpeten:platform-choice")
export class PlatformChoice {
  private static readonly HOSTS: ReadonlyMap<string, PlatformKind> = new Map<string, PlatformKind>([
    ["github.com", "github"],
    ["gitlab.com", "gitlab"],
  ]);

  private static readonly SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):/;

  private static readonly HINT = `set \`platform: github\` or \`platform: gitlab\` in ${ConfigLoader.CONFIG_FILE}`;

  @Use(Git)
  private readonly git!: Git;

  @Use(GitHubPlatform)
  private readonly github!: GitHubPlatform;

  @Use(GitLabPlatform)
  private readonly gitlab!: GitLabPlatform;

  @RunValue("config")
  private readonly config!: KerpetenConfig;

  private chosen: Promise<PlatformKind> | undefined;

  /**
   * The host of a remote URL in lowercase, without user and port: of a URL with a scheme, such as `https://` and
   * `ssh://`, and of the `git@host:path` form. A path on this machine has none.
   */
  private static remoteHost(url: string): string | undefined {
    if (!url.includes("://")) return PlatformChoice.SCP_LIKE.exec(url)?.[1]?.toLowerCase();

    try {
      const host = new URL(url).hostname.toLowerCase();

      return host === "" ? undefined : host;
    } catch {
      return undefined;
    }
  }

  /** The kind of the run's platform. Every call of a run gives the same answer, or the same error. */
  public kind(): Promise<PlatformKind> {
    this.chosen ??= this.choose();

    return this.chosen;
  }

  /** The platform of the run: the one capability the review reads merge requests through. */
  public async platform(): Promise<Platform> {
    const platforms: Readonly<Record<PlatformKind, Platform>> = { github: this.github, gitlab: this.gitlab };

    return platforms[await this.kind()];
  }

  private async choose(): Promise<PlatformKind> {
    const configured = this.config.platform;

    if (configured !== undefined) return configured;

    const url = await this.git.originUrl();

    if (url === undefined) {
      throw new PlatformChoiceError(
        `this repository has no origin remote to tell the platform from: ${PlatformChoice.HINT}`,
      );
    }

    const host = PlatformChoice.remoteHost(url);

    if (host === undefined) {
      throw new PlatformChoiceError(
        `the URL of the origin remote names no host to tell the platform from: ${PlatformChoice.HINT}`,
      );
    }

    const kind = PlatformChoice.HOSTS.get(host);

    if (kind === undefined) {
      throw new PlatformChoiceError(
        `the origin remote is on ${terminalLine(host)}, which is neither github.com nor gitlab.com: ${PlatformChoice.HINT}`,
      );
    }

    return kind;
  }
}
