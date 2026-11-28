import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { GitHubPlatform } from "../../../src/capability/platform/GitHubPlatform.ts";
import { GitLabPlatform } from "../../../src/capability/platform/GitLabPlatform.ts";
import { PlatformChoice } from "../../../src/capability/platform/PlatformChoice.ts";
import { PlatformChoiceError } from "../../../src/capability/platform/PlatformChoiceError.ts";
import { PlatformError } from "../../../src/capability/platform/PlatformError.ts";
import { PlatformWords } from "../../../src/capability/platform/PlatformWords.ts";
import { runComponent } from "../../app/app-utils.ts";
import { sh, tempRepo } from "../git/git-utils.ts";

const HINT = "set `platform: github` or `platform: gitlab` in .kerpeten.yml";

const NEEDS =
  "a review of a pull request or merge request reads it from the project of the origin remote, so the remote must be the address of a project on GitHub or GitLab";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose remote `origin` has the URL `origin`, or no remote at all when none is given. */
function repo(origin?: string): string {
  const dir = tempRepo("kerpeten-platform-choice-");

  dirs.push(dir);

  if (origin !== undefined) sh(dir, ["remote", "add", "origin", origin]);

  return dir;
}

/** The platform choice of a new run in `dir` whose configuration names `platform`, or names none. */
function choice(dir: string, platform?: "github" | "gitlab"): Promise<PlatformChoice> {
  return runComponent(PlatformChoice, { repo: dir, config: platform === undefined ? {} : { platform } });
}

async function refusal(dir: string): Promise<string> {
  const chosen = await choice(dir);

  try {
    await chosen.platform();
  } catch (error) {
    if (error instanceof PlatformChoiceError || error instanceof PlatformError) return error.message;

    throw error;
  }

  throw new Error("a platform was chosen");
}

describe("platform choice", () => {
  test("the platform key of the configuration names the platform", async () => {
    const github = await choice(repo(), "github");
    const gitlab = await choice(repo(), "gitlab");

    expect(await github.kind()).toBe("github");
    expect(await github.platform()).toBeInstanceOf(GitHubPlatform);
    expect(await gitlab.kind()).toBe("gitlab");
    expect(await gitlab.platform()).toBeInstanceOf(GitLabPlatform);
  });

  test("the configuration wins over the remote, whatever host the remote is on", async () => {
    const onGitLab = await choice(repo("https://gitlab.com/acme/shop.git"), "github");
    const onGitHub = await choice(repo("git@github.com:acme/shop.git"), "gitlab");
    const selfHosted = await choice(repo("https://git.example.com/acme/shop.git"), "gitlab");

    expect(await onGitLab.platform()).toBeInstanceOf(GitHubPlatform);
    expect(await onGitHub.platform()).toBeInstanceOf(GitLabPlatform);
    expect(await selfHosted.platform()).toBeInstanceOf(GitLabPlatform);
  });

  const known: [string, "github" | "gitlab"][] = [
    ["https://github.com/acme/shop.git", "github"],
    ["ssh://git@github.com/acme/shop.git", "github"],
    ["git@github.com:acme/shop.git", "github"],
    ["https://gitlab.com/acme/group/shop.git", "gitlab"],
    ["ssh://git@gitlab.com/acme/group/shop.git", "gitlab"],
    ["git@gitlab.com:acme/group/shop.git", "gitlab"],
    ["https://GitHub.COM/acme/shop", "github"],
    ["ssh://git@GitLab.com:22/acme/shop.git", "gitlab"],
    ["https://oauth2:not-a-token@gitlab.com/acme/shop.git", "gitlab"],
    ["http://github.com/acme/shop.git", "github"],
    ["gitlab.com:acme/shop.git", "gitlab"],
    ["GIT@GITHUB.COM:acme/shop.git", "github"],
  ];

  for (const [origin, kind] of known) {
    test(`without the key, an origin remote at ${origin} is ${kind}`, async () => {
      const chosen = await choice(repo(origin));

      expect(await chosen.kind()).toBe(kind);
      expect(await chosen.platform()).toBeInstanceOf(kind === "github" ? GitHubPlatform : GitLabPlatform);
      expect(await chosen.platform()).toBe(await chosen.platform());
    });
  }

  test("the URL is read as git uses it, with its insteadOf rewrites", async () => {
    const dir = repo("work:acme/shop.git");

    sh(dir, ["config", "url.https://gitlab.com/.insteadOf", "work:"]);

    expect(await (await choice(dir)).kind()).toBe("gitlab");
  });

  const unknown: [string, string][] = [
    ["https://git.example.com/acme/shop.git", "git.example.com"],
    ["ssh://git@gitlab.example.com:2222/acme/shop.git", "gitlab.example.com"],
    ["git@github.example.com:acme/shop.git", "github.example.com"],
    ["https://github.com.example.org/acme/shop.git", "github.com.example.org"],
    ["ssh://git@ssh.github.com:443/acme/shop.git", "ssh.github.com"],
    ["https://user:hunter2@Git.Example.com/acme/shop.git", "git.example.com"],
  ];

  for (const [origin, host] of unknown) {
    test(`without the key, an origin remote at ${origin} is refused: the host name is not guessed from`, async () => {
      const message = await refusal(repo(origin));

      expect(message).toBe(`the origin remote is on ${host}, which is neither github.com nor gitlab.com: ${HINT}`);
      expect(message).not.toContain("hunter2");
    });
  }

  test("git's remote helper form is read when its address is a URL with a host", async () => {
    const helped: [string, "github" | "gitlab"][] = [
      ["https::https://gitlab.com/acme/shop.git", "gitlab"],
      ["ssh::ssh://git@gitlab.com/acme/shop.git", "gitlab"],
      ["https::https://github.com/acme/shop.git", "github"],
    ];

    for (const [origin, kind] of helped) {
      expect(await (await choice(repo(origin))).kind()).toBe(kind);
    }

    expect(await refusal(repo("https::https://git.example.com/acme/shop.git"))).toBe(
      `the origin remote is on git.example.com, which is neither github.com nor gitlab.com: ${HINT}`,
    );
  });

  test("a remote helper from which no host can be told is refused: the platform is not guessed from its name", async () => {
    for (const origin of ["gitlab::acme/shop", "ext::ssh -q git@gitlab.com %S acme/shop", "github::acme/shop"]) {
      const message = await refusal(repo(origin));

      expect(message).toStartWith("the origin remote uses git's remote helper ");
      expect(message).toEndWith(`, whose address is no URL with a host: ${NEEDS}`);
    }
  });

  test("without the key, a repository without an origin remote is refused, also when another remote is on a known host", async () => {
    const message =
      "this repository has no origin remote: a review of a pull request or merge request reads it from the project of the origin remote, so add one with `git remote add origin <address of the project>`";

    const other = repo();

    sh(other, ["remote", "add", "upstream", "https://gitlab.com/acme/shop.git"]);

    expect(await refusal(repo())).toBe(message);
    expect(await refusal(other)).toBe(message);
  });

  test("without the key, an origin remote that is a path on this machine is refused", async () => {
    const message = `the origin remote is a path on this machine: ${NEEDS}`;

    for (const origin of ["/srv/git/shop.git", "../shop.git", "file:///srv/git/shop.git", "./a:b/shop.git"]) {
      expect(await refusal(repo(origin))).toBe(message);
    }
  });

  test("a run chooses once: the refusal is the same on every call", async () => {
    const chosen = await choice(repo());

    await expect(chosen.kind()).rejects.toThrow(PlatformError);
    await expect(chosen.platform()).rejects.toThrow("this repository has no origin remote");

    const unknown = await choice(repo("https://git.example.com/acme/shop.git"));

    await expect(unknown.kind()).rejects.toThrow(PlatformChoiceError);
    await expect(unknown.platform()).rejects.toThrow("neither github.com nor gitlab.com");
  });
});

describe("platform words", () => {
  test("each platform has its name for a merge request and the command of its CLI that checks one out", () => {
    expect(PlatformWords.of("github").noun).toBe("pull request");
    expect(PlatformWords.of("github").checkoutCommand(12)).toBe("gh pr checkout 12");
    expect(PlatformWords.of("gitlab").noun).toBe("merge request");
    expect(PlatformWords.of("gitlab").checkoutCommand(12)).toBe("glab mr checkout 12");
  });
});
