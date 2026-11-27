import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { Git } from "../../src/capability/git/Git.ts";
import { HeadCommit } from "../../src/capability/git/HeadCommit.ts";
import { RepoJail } from "../../src/capability/repo/RepoJail.ts";
import { RepoLimits } from "../../src/capability/repo/RepoLimits.ts";
import { RipgrepSearch } from "../../src/capability/repo/RipgrepSearch.ts";
import { SearchTimer } from "../../src/capability/repo/SearchTimer.ts";
import {
  harnessSpec,
  type PermissionGrant,
  type Run,
  Toolbox,
  type ToolClass,
  type ToolOutcome,
  toolSpec,
} from "../../src/harness-kit/index.ts";
import { ReviewerHarness } from "../../src/harnesses/review/ReviewerHarness.ts";
import { LineSplitter } from "../../src/text/LineSplitter.ts";
import { GlobTool } from "../../src/tools/glob/GlobTool.ts";
import { GrepTool } from "../../src/tools/grep/GrepTool.ts";
import { ToolLimits } from "../../src/tools/ToolLimits.ts";
import { openRun } from "../app/app-utils.ts";
import { OpenJail } from "./OpenJail.ts";
import { PinnedHead } from "./PinnedHead.ts";
import { SandboxGit } from "./SandboxGit.ts";
import { TestRipgrep } from "./TestRipgrep.ts";
import { TestTimer } from "./TestTimer.ts";
import { fakeRg, SECRET, sandbox, TOKEN, trackedPaths, treeHash } from "./tools-utils.ts";
import type { Sandbox, Session, SessionOptions } from "./types/tools.ts";

const REVIEWER_TOOLS = harnessSpec(ReviewerHarness).tools;

const ALL: PermissionGrant = { group: "all", every: true };

const PATH_ENV = Bun.env.PATH ?? "/usr/bin:/bin";

const REPLACED: readonly unknown[] = [Git, RipgrepSearch, SearchTimer];

const SANDBOXED = [
  ...KerpetenApp.COMPONENTS.filter((component) => !REPLACED.includes(component)),
  SandboxGit,
  TestRipgrep,
  TestTimer,
];

const OPEN = [...SANDBOXED.filter((component) => component !== RepoJail), OpenJail];

let box: Sandbox;
let tools: Session;

/**
 * A run over the sandbox: its tracked paths walked from the disk unless given, ripgrep, the search time limit and the
 * clock as in production unless given. The search timer is the container's one, so the latest run sets it.
 */
async function runOf(options: SessionOptions = {}, grant: PermissionGrant = ALL, components = SANDBOXED): Promise<Run> {
  const repo = options.repo ?? box.repo;

  const run = await openRun(
    { repo, pathEnv: PATH_ENV, tracked: options.tracked ?? trackedPaths(repo), rgCommand: options.rgCommand ?? "rg" },
    { grant, components, give: (opened) => opened.give(HeadCommit, new PinnedHead()) },
  );

  const timer = await run.ready(TestTimer);

  timer.set(options.timeoutMs ?? RepoLimits.SEARCH_TIMEOUT_MS, options.clock ?? (() => performance.now()));

  return run;
}

async function registry(options: SessionOptions = {}): Promise<Session> {
  const toolbox = toolboxOf(REVIEWER_TOOLS, await runOf(options));

  return { definitions: toolbox.specs, execute: (name, input) => toolbox.execute(name, input) };
}

function toolboxOf(tools: readonly ToolClass[], run: Run): Toolbox {
  return new Toolbox(
    tools.map((tool) => ({ spec: toolSpec(tool), handler: new tool() })),
    run,
  );
}

async function jailOf(repo: string): Promise<RepoJail> {
  return (await runOf({ repo })).ready(RepoJail);
}

beforeAll(async () => {
  box = sandbox();

  const first = await registry();

  tools = {
    definitions: first.definitions,
    execute: async (name, input) => (await registry()).execute(name, input),
  };
});

afterAll(() => {
  rmSync(box.base, { recursive: true, force: true });
});

function output(result: ToolOutcome): Record<string, unknown> {
  if (!result.ok) throw new Error(result.error);

  return result.output as Record<string, unknown>;
}

function errorOf(result: ToolOutcome): string {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.output)}`);

  return result.error;
}

describe("registry", () => {
  test("states each tool's limits from the constants that enforce them", () => {
    const description = (name: string) => tools.definitions.find((d) => d.name === name)?.description ?? "";

    expect(description("list_dir")).toContain(`At most ${ToolLimits.LIST_DIR_MAX_ENTRIES} entries`);
    expect(description("glob")).toContain(`At most ${ToolLimits.GLOB_MAX_RESULTS} results`);
    expect(description("grep")).toContain(`At most ${RepoLimits.GREP_MAX_MATCHES} matches`);
    expect(description("grep")).toContain(`${RepoLimits.GREP_MAX_LINE_CHARS} characters`);
    expect(description("grep")).toContain(`${RepoLimits.MAX_FILE_BYTES / 1024 / 1024} MB`);
  });

  test("registers exactly the four read-only tools", () => {
    expect(tools.definitions.map((d) => d.name)).toEqual(["list_dir", "read_file", "grep", "glob"]);
    expect(REVIEWER_TOOLS.map((tool) => toolSpec(tool).name)).toEqual(["list_dir", "read_file", "grep", "glob"]);
  });

  test("under a group that gives repo:search but not repo:read, ripgrep still gets its jail", async () => {
    const searchOnly: PermissionGrant = { group: "search-only", every: false, permissions: ["repo:search"] };
    const search = await (await runOf({}, searchOnly)).ready(RipgrepSearch);
    const chunks: Uint8Array[] = [];
    const query = { pattern: "needle", target: "src", caseInsensitive: false, fixedStrings: true };

    const outcome = await search.search(query, (chunk) => {
      chunks.push(chunk);

      return true;
    });

    expect(outcome).toMatchObject({ kind: "exited", exitCode: 0 });
    expect(Buffer.concat(chunks).toString("utf8")).toContain("src/b.ts");
  });

  test("a session without repo:search still offers grep, but its call fails and ripgrep is never built", async () => {
    const paths: PermissionGrant = { group: "paths", every: false, permissions: ["repo:read"] };
    const built = TestRipgrep.built;
    const toolbox = toolboxOf(REVIEWER_TOOLS, await runOf({}, paths));

    expect(toolbox.specs.map((spec) => spec.name)).toEqual(["list_dir", "read_file", "grep", "glob"]);

    expect(await toolbox.execute("grep", { pattern: "needle" })).toEqual({
      ok: false,
      error:
        'grep failed: GrepTool.ripgrep needs the capability ripgrep, which the permission group "paths" does not give',
    });

    expect(TestRipgrep.built).toBe(built);

    expect(output(await toolbox.execute("read_file", { path: "src/b.ts" })).content).toBe("1\tneedle");
  });

  test("answers any other tool name with an unknown-tool result, not an exception", async () => {
    for (const name of ["shell", "write_file", "fetch_url", "bash", "edit_file", "", "READ_FILE", "__proto__"]) {
      expect(errorOf(await tools.execute(name, { path: "x", command: "rm -rf /" }))).toContain("unknown tool");
    }
  });

  test("refuses input that does not match the tool schema", async () => {
    expect(errorOf(await tools.execute("read_file", {}))).toContain("invalid input");
    expect(errorOf(await tools.execute("read_file", { path: "src/a.ts", mode: "w" }))).toContain("invalid input");
    expect(errorOf(await tools.execute("read_file", { path: 1 }))).toContain("invalid input");
    expect(errorOf(await tools.execute("read_file", { path: "src/a.ts", start_line: 0 }))).toContain("invalid input");
    expect(errorOf(await tools.execute("grep", { pattern: "" }))).toContain("invalid input");
    expect(errorOf(await tools.execute("list_dir", null))).toContain("invalid input");
    expect(errorOf(await tools.execute("glob", "**"))).toContain("invalid input");
  });
});

describe("path jail", () => {
  const escapes = [
    "../outside/secret.txt",
    "src/../../outside/secret.txt",
    "/etc/passwd",
    join("/", "tmp"),
    "out-file",
    "out-dir/secret.txt",
    "out-dir",
    "evil-link/secret.txt",
    ".git/config",
    ".git",
    "src/../.git/config",
    ".GIT/config",
    "git-link",
    "git-dir-link/config",
    "src/a.ts\0",
    "C:\\Windows\\win.ini",
    "\\\\server\\share",
    "x".repeat(5000),
  ];

  test("refuses every way out of the repository and into .git", async () => {
    const jail = await jailOf(box.repo);

    for (const path of escapes) expect(jail.resolve(path).ok).toBe(false);
  });

  test("allows paths inside, including a symlink that stays inside", async () => {
    const jail = await jailOf(box.repo);

    expect(jail.resolve("src/a.ts")).toEqual({
      ok: true,
      absolute: join(jail.root, "src", "a.ts"),
      relative: "src/a.ts",
    });

    expect(jail.resolve("in-link.ts")).toMatchObject({ ok: true, relative: "src/a.ts" });
    expect(jail.resolve("./src/../src/a.ts")).toMatchObject({ ok: true, relative: "src/a.ts" });
    expect(jail.resolve(".")).toMatchObject({ ok: true, relative: "." });
  });

  test("does not reveal whether a path behind an escaping symlink exists", async () => {
    const jail = await jailOf(box.repo);

    for (const [present, absent] of [
      ["out-dir/secret.txt", "out-dir/nope.txt"],
      ["evil-link/secret.txt", "evil-link/nope/deeper.txt"],
      ["git-dir-link/config", "git-dir-link/nope"],
    ] as const) {
      const a = jail.resolve(present);
      const b = jail.resolve(absent);

      expect(a.ok).toBe(false);
      expect(b).toEqual(a);
    }

    expect(jail.resolve("src/nope.ts")).toEqual({ ok: false, error: "path does not exist" });
    expect(jail.resolve("nope/deeper/x.ts")).toEqual({ ok: false, error: "path does not exist" });
  });

  test("answers a dangling symlink to a missing outside file as it answers one to an existing file", async () => {
    const local = sandbox();

    try {
      symlinkSync(join(local.outside, "nope.txt"), join(local.repo, "dangling-out"));
      symlinkSync(join(local.outside, "nope", "deeper.txt"), join(local.repo, "dangling-deep"));
      symlinkSync("dangling-out", join(local.repo, "dangling-chain"));
      symlinkSync(join(local.repo, ".git", "nope"), join(local.repo, "dangling-git"));
      symlinkSync("src/nope.ts", join(local.repo, "dangling-in"));

      const jail = await jailOf(local.repo);
      const outsideFile = jail.resolve("out-file");

      expect(outsideFile).toEqual({ ok: false, error: "path is outside the repository" });

      for (const path of ["dangling-out", "dangling-deep", "dangling-chain", "dangling-out/x", "dangling-chain/x/y"]) {
        expect(jail.resolve(path)).toEqual(outsideFile);
      }

      expect(jail.resolve("dangling-git")).toEqual(jail.resolve("git-link"));
      expect(jail.resolve("dangling-in")).toEqual({ ok: false, error: "path does not exist" });
    } finally {
      rmSync(local.base, { recursive: true, force: true });
    }
  });

  test("a sibling directory sharing the root's name prefix is outside", async () => {
    const jail = await jailOf(box.repo);

    expect(jail.resolve("../repo-evil/secret.txt").ok).toBe(false);
  });
});

describe("read_file", () => {
  test("reads numbered lines and a range", async () => {
    expect(output(await tools.execute("read_file", { path: "src/a.ts" }))).toEqual({
      path: "src/a.ts",
      start_line: 1,
      end_line: 2,
      total_lines: 2,
      truncated: false,
      content: "1\texport const a = 1;\n2\texport const needle = 2;",
    });

    expect(output(await tools.execute("read_file", { path: "src/a.ts", start_line: 2, end_line: 9 })).content).toBe(
      "2\texport const needle = 2;",
    );
  });

  test("numbers lines as the candidate check does, even after a second byte order mark", async () => {
    const text = "\uFEFF\uFEFFfirst\r\nsecond\n";

    try {
      writeFileSync(join(box.repo, "bom.txt"), text);

      const lines = LineSplitter.split(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text)));
      const result = output(await tools.execute("read_file", { path: "bom.txt" }));

      expect(result.content).toBe(lines.map((line, i) => `${i + 1}\t${line}`).join("\n"));
      expect(result.content).toBe("1\tfirst\n2\tsecond");
    } finally {
      rmSync(join(box.repo, "bom.txt"), { force: true });
    }
  });

  test("refuses escapes, .git, binaries, directories and reversed ranges", async () => {
    for (const path of [
      "../outside/secret.txt",
      "out-file",
      "out-dir/secret.txt",
      ".git/config",
      "git-link",
      "/etc/hostname",
    ]) {
      expect((await tools.execute("read_file", { path })).ok).toBe(false);
    }

    expect(errorOf(await tools.execute("read_file", { path: "bin.dat" }))).toBe("binary file");
    expect(errorOf(await tools.execute("read_file", { path: "src" }))).toBe("not a regular file");

    expect(errorOf(await tools.execute("read_file", { path: "src/a.ts", start_line: 2, end_line: 1 }))).toContain(
      "end_line",
    );
  });

  test("answers a start_line past the end with the last lines of the file and says so", async () => {
    expect(output(await tools.execute("read_file", { path: "src/a.ts", start_line: 99 }))).toEqual({
      path: "src/a.ts",
      start_line: 1,
      end_line: 2,
      total_lines: 2,
      truncated: false,
      notice: "start_line 99 is past the end of the file (2 lines); showing its last 2 lines.",
      content: "1\texport const a = 1;\n2\texport const needle = 2;",
    });

    try {
      writeFileSync(join(box.repo, "tail.txt"), Array.from({ length: 250 }, (_, i) => `t${i + 1}\n`).join(""));

      const tail = output(await tools.execute("read_file", { path: "tail.txt", start_line: 251, end_line: 260 }));

      expect(tail.start_line).toBe(250 - ToolLimits.READ_FILE_TAIL_LINES + 1);
      expect(tail.end_line).toBe(250);

      expect(String(tail.content).split("\n")[0]).toBe(
        `${250 - ToolLimits.READ_FILE_TAIL_LINES + 1}\tt${250 - ToolLimits.READ_FILE_TAIL_LINES + 1}`,
      );

      expect(output(await tools.execute("read_file", { path: "tail.txt", start_line: 250 })).content).toBe("250\tt250");
      writeFileSync(join(box.repo, "tail.txt"), "");

      expect(output(await tools.execute("read_file", { path: "tail.txt" }))).toMatchObject({
        start_line: 1,
        end_line: 0,
        total_lines: 0,
        truncated: false,
        content: "",
      });

      expect(output(await tools.execute("read_file", { path: "tail.txt", start_line: 2 }))).toMatchObject({
        end_line: 0,
        total_lines: 0,
        content: "",
        notice: "start_line 2 is past the end of the file (0 lines); showing its last 0 lines.",
      });
    } finally {
      rmSync(join(box.repo, "tail.txt"), { force: true });
    }
  });

  test("caps a call at 2000 lines and 200 KB", async () => {
    writeFileSync(join(box.repo, "long.txt"), `${Array.from({ length: 2500 }, (_, i) => `l${i + 1}`).join("\n")}\n`);

    const long = output(await tools.execute("read_file", { path: "long.txt" }));

    expect(long.end_line).toBe(2000);
    expect(long.truncated).toBe(true);
    expect(long.notice).toBe("Output truncated. If you need more of this file, continue with start_line 2001.");

    const next = output(await tools.execute("read_file", { path: "long.txt", start_line: 2001 }));

    expect(next.end_line).toBe(2500);
    expect(next.truncated).toBe(false);
    expect(next.notice).toBeUndefined();

    const ranged = output(await tools.execute("read_file", { path: "long.txt", start_line: 10, end_line: 12 }));

    expect(ranged).toMatchObject({ start_line: 10, end_line: 12, total_lines: 2500, truncated: false });
    expect(ranged.notice).toBeUndefined();
    writeFileSync(join(box.repo, "wide.txt"), `${"x".repeat(1000)}\n`.repeat(400));

    const wide = output(await tools.execute("read_file", { path: "wide.txt" }));

    expect(Buffer.byteLength(String(wide.content))).toBeLessThanOrEqual(ToolLimits.READ_FILE_MAX_BYTES);
    expect(wide.truncated).toBe(true);

    expect(wide.notice).toBe(
      `Output truncated. If you need more of this file, continue with start_line ${Number(wide.end_line) + 1}.`,
    );

    rmSync(join(box.repo, "long.txt"));
    rmSync(join(box.repo, "wide.txt"));
  });

  test("cuts each long line at 2000 characters with a visible mark, without splitting a character", async () => {
    try {
      writeFileSync(join(box.repo, "minified.js"), `${"é".repeat(ToolLimits.READ_FILE_MAX_BYTES)}\nshort\n`);

      const first = output(await tools.execute("read_file", { path: "minified.js" }));

      expect(first).toEqual({
        path: "minified.js",
        start_line: 1,
        end_line: 2,
        total_lines: 2,
        truncated: false,
        content: `1\t${"é".repeat(ToolLimits.READ_FILE_MAX_LINE_CHARS)}${ToolLimits.LINE_CUT_SUFFIX}\n2\tshort`,
      });

      writeFileSync(
        join(box.repo, "minified.js"),
        `${"x".repeat(ToolLimits.READ_FILE_MAX_LINE_CHARS - 1)}\u{1F600}\r\n${"y".repeat(ToolLimits.READ_FILE_MAX_LINE_CHARS)}\r\n`,
      );

      expect(output(await tools.execute("read_file", { path: "minified.js" })).content).toBe(
        `1\t${"x".repeat(ToolLimits.READ_FILE_MAX_LINE_CHARS - 1)}${ToolLimits.LINE_CUT_SUFFIX}\n2\t${"y".repeat(ToolLimits.READ_FILE_MAX_LINE_CHARS)}`,
      );
    } finally {
      rmSync(join(box.repo, "minified.js"), { force: true });
    }
  });

  test("reads a one-line file of 16 MB in bounded output", async () => {
    try {
      writeFileSync(join(box.repo, "bundle.min.js"), "var a=1;".repeat(2_000_000));

      const result = output(await tools.execute("read_file", { path: "bundle.min.js" }));

      expect(result).toMatchObject({ start_line: 1, end_line: 1, total_lines: 1, truncated: false });
      expect(String(result.content)).toBe(`1\t${"var a=1;".repeat(250)}${ToolLimits.LINE_CUT_SUFFIX}`);
    } finally {
      rmSync(join(box.repo, "bundle.min.js"), { force: true });
    }
  }, 30_000);

  test("numbers lines across read chunks as LineSplitter.split does for the whole text", async () => {
    try {
      const parts: string[] = ["\uFEFF"];
      let size = 1;

      for (let i = 0; size < 3 * 1024 * 1024; i++) {
        const part = `${"line ".repeat(i % 37)}${i}${i % 3 === 0 ? "\r\n" : i % 7 === 0 ? "\r" : "\n"}`;

        parts.push(part);
        size += part.length;
      }

      const text = parts.join("");

      writeFileSync(join(box.repo, "chunks.txt"), text);

      const lines = LineSplitter.split(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(text)));

      for (const start of [1, 700, lines.length - 5]) {
        const result = output(await tools.execute("read_file", { path: "chunks.txt", start_line: start }));

        expect(result.total_lines).toBe(lines.length);

        const shown = String(result.content).split("\n");

        expect(shown).toEqual(
          lines.slice(start - 1, start - 1 + shown.length).map((line, i) => `${start + i}\t${line}`),
        );
      }
    } finally {
      rmSync(join(box.repo, "chunks.txt"), { force: true });
    }
  }, 30_000);

  test("refuses a file over 20 MB and a file that is not UTF-8", async () => {
    try {
      const fd = openSync(join(box.repo, "huge.txt"), "w");

      ftruncateSync(fd, RepoLimits.MAX_FILE_BYTES + 1);
      closeSync(fd);
      expect(errorOf(await tools.execute("read_file", { path: "huge.txt" }))).toBe("file is too large to read");
      writeFileSync(join(box.repo, "huge.txt"), "a\n".repeat(RepoLimits.MAX_FILE_BYTES / 2));
      expect((await tools.execute("read_file", { path: "huge.txt", end_line: 1 })).ok).toBe(true);
      writeFileSync(join(box.repo, "latin1.txt"), new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]));
      expect(errorOf(await tools.execute("read_file", { path: "latin1.txt" }))).toBe("not a UTF-8 text file");

      writeFileSync(
        join(box.repo, "latin1.txt"),
        Buffer.concat([Buffer.from("ok\n".repeat(100_000)), Buffer.from([0xe9])]),
      );

      expect(errorOf(await tools.execute("read_file", { path: "latin1.txt", end_line: 1 }))).toBe(
        "not a UTF-8 text file",
      );
    } finally {
      rmSync(join(box.repo, "huge.txt"), { force: true });
      rmSync(join(box.repo, "latin1.txt"), { force: true });
    }
  });
});

describe("list_dir", () => {
  test("lists the root without .git and reports symlinks as symlinks", async () => {
    const listing = output(await tools.execute("list_dir", {}));
    const entries = listing.entries as { name: string; type: string }[];

    expect(entries.map((e) => e.name)).not.toContain(".git");
    expect(entries.find((e) => e.name === "out-dir")?.type).toBe("symlink");
    expect(entries.find((e) => e.name === "src")?.type).toBe("dir");
  });

  test("stops at 500 entries", async () => {
    const dir = join(box.repo, "crowd");

    try {
      mkdirSync(dir);

      for (let i = 0; i < ToolLimits.LIST_DIR_MAX_ENTRIES + 1; i++)
        writeFileSync(join(dir, `f${String(i).padStart(4, "0")}`), "");

      const listing = output(await tools.execute("list_dir", { path: "crowd" }));

      expect((listing.entries as unknown[]).length).toBe(500);
      expect(listing.truncated).toBe(true);
      rmSync(join(dir, "f0000"));

      const exact = output(await tools.execute("list_dir", { path: "crowd" }));

      expect((exact.entries as unknown[]).length).toBe(500);
      expect(exact.truncated).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("lists dot-files other than .git", async () => {
    const entries = output(await tools.execute("list_dir", {})).entries as { name: string }[];

    expect(entries.map((e) => e.name)).toContain(".github");
  });

  test("refuses directories outside the repository and .git", async () => {
    for (const path of ["..", "/", "out-dir", ".git", "git-dir-link", "src/a.ts"]) {
      expect((await tools.execute("list_dir", { path })).ok).toBe(false);
    }
  });
});

describe("glob", () => {
  test("finds files inside the repository only", async () => {
    const files = output(await tools.execute("glob", { pattern: "**/*" })).files as string[];

    expect(files).toContain("src/a.ts");

    expect(
      files.some(
        (f) =>
          f === ".git" || f.toLowerCase().startsWith(".git/") || f.startsWith("out-dir") || f.startsWith("evil-link"),
      ),
    ).toBe(false);

    expect(files).toContain(".github/workflows/ci.yml");
    expect(files).not.toContain("out-file");
    expect(files).not.toContain("git-link");
  });

  test("refuses patterns that climb out or name .git", async () => {
    for (const pattern of [
      "../**",
      "/etc/*",
      "src/../../*",
      ".git/*",
      "**/.git/**",
      ".GIT/*",
      "src/.Git",
      "C:/x",
      "\\x",
    ]) {
      expect((await tools.execute("glob", { pattern })).ok).toBe(false);
    }

    expect((await tools.execute("glob", { pattern: "*", path: "out-dir" })).ok).toBe(false);
  });

  test("finds files under dot-directories that read_file can open", async () => {
    expect(output(await tools.execute("glob", { pattern: "**/*.yml" })).files).toEqual([
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
    ]);
  });

  test("stops at 1000 results", async () => {
    const dir = join(box.repo, "many");

    try {
      mkdirSync(dir);

      for (let i = 0; i < ToolLimits.GLOB_MAX_RESULTS + 1; i++) writeFileSync(join(dir, `f${i}.txt`), "");

      const result = output(await tools.execute("glob", { pattern: "*.txt", path: "many" }));

      expect((result.files as unknown[]).length).toBe(1000);
      expect(result.truncated).toBe(true);

      expect(result.notice).toBe(
        "(Results are truncated: showing first 1000 results. Consider using a more specific path or pattern.)",
      );

      const names = Array.from({ length: ToolLimits.GLOB_MAX_RESULTS + 1 }, (_, i) => `many/f${i}.txt`).sort();

      expect(result.files).toEqual(names.slice(0, ToolLimits.GLOB_MAX_RESULTS));
      rmSync(join(dir, "f0.txt"));

      const exact = output(await tools.execute("glob", { pattern: "*.txt", path: "many" }));

      expect((exact.files as unknown[]).length).toBe(1000);
      expect(exact.truncated).toBe(false);
      expect(exact.notice).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("does not enter .git and skips directories it cannot read", async () => {
    const locked = [join(box.repo, ".git", "objects-locked"), join(box.repo, "locked")];

    try {
      for (const dir of locked) {
        mkdirSync(dir);
        writeFileSync(join(dir, "hidden.ts"), "");
        chmodSync(dir, 0);
      }

      const withLocked = await registry({ tracked: [...trackedPaths(box.repo), "locked/hidden.ts"] });
      const files = output(await withLocked.execute("glob", { pattern: "**/*.ts" })).files;

      expect(files).toEqual(["src/a.ts", "src/b.ts"]);
    } finally {
      for (const dir of locked) {
        chmodSync(dir, 0o755);
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("matches patterns that start with literal directories", async () => {
    const files = async (pattern: string) => output(await tools.execute("glob", { pattern })).files;

    expect(await files("src/*.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(await files("src/**/*.ts")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(await files("docs/readme.md")).toEqual(["docs/readme.md"]);
    expect(await files("{src,docs}/*")).toEqual(["docs/readme.md", "src/a.ts", "src/b.ts"]);
    expect(await files(".github/**/*.yml")).toEqual([".github/workflows/ci.yml"]);
    expect(await files("out-dir/*")).toEqual([]);
  });

  test("checks the time limit for each tracked file it looks at", async () => {
    const jail = await jailOf(box.repo);

    const run = async (limit: number) => {
      let tick = 0;
      const timed = await runOf({ timeoutMs: limit, clock: () => tick++ });

      return toolboxOf([GlobTool], timed).execute("glob", { pattern: "**/*" });
    };

    expect((await run(jail.files.length + 1)).ok).toBe(true);

    expect(await run(jail.files.length)).toEqual({
      ok: false,
      error: `glob timed out after ${jail.files.length} ms`,
    });
  });

  test("does not return a tracked symlink, only the regular file it may point to", async () => {
    expect(output(await tools.execute("glob", { pattern: "*.ts" })).files).toEqual([]);
    expect(output(await tools.execute("glob", { pattern: "*-link*" })).files).toEqual([]);
  });

  test("gives up with an error once the time limit has passed", async () => {
    const slow = await registry({ timeoutMs: 0 });

    expect(errorOf(await slow.execute("glob", { pattern: "**/*" }))).toBe("glob timed out after 0 ms");
  });

  test("reads a pattern that starts with ./ as relative to its base", async () => {
    expect(output(await tools.execute("glob", { pattern: "./src/*.ts" })).files).toEqual(["src/a.ts", "src/b.ts"]);

    expect(output(await tools.execute("glob", { pattern: "././*.ts", path: "src" })).files).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);

    expect(errorOf(await tools.execute("glob", { pattern: "./" }))).toContain("pattern");
  });

  test("refuses a path that is not a directory", async () => {
    expect(errorOf(await tools.execute("glob", { pattern: "*", path: "src/a.ts" }))).toBe("not a directory");
    expect(errorOf(await tools.execute("glob", { pattern: "*", path: "in-link.ts" }))).toBe("not a directory");
  });

  test("says that the pattern is relative to path", () => {
    const glob = tools.definitions.find((d) => d.name === "glob");

    expect(glob?.description).toContain("relative to path");
  });

  test("scopes to a sub-directory and returns repo-relative paths", async () => {
    expect(output(await tools.execute("glob", { pattern: "*.ts", path: "src" })).files).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("grep", () => {
  test("finds matches inside the repository with repo-relative paths", async () => {
    const result = output(await tools.execute("grep", { pattern: "needle" }));
    const paths = (result.matches as { path: string }[]).map((m) => m.path).sort();

    expect(paths).toEqual(["docs/readme.md", "src/a.ts", "src/b.ts"]);
  });

  test("searches dot-files and dot-directories other than .git", async () => {
    const result = output(await tools.execute("grep", { pattern: "push-marker" }));

    expect((result.matches as { path: string }[]).map((m) => m.path).sort()).toEqual([
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
    ]);
  });

  test("ignores ignore files in the repository and in the directories above it", async () => {
    for (const file of [
      join(box.repo, ".ignore"),
      join(box.repo, ".rgignore"),
      join(box.repo, ".gitignore"),
      join(box.repo, "src", ".ignore"),
      join(box.base, ".ignore"),
      join(box.base, ".rgignore"),
    ]) {
      writeFileSync(file, "docs/\nb.ts\n*.ts\n");

      try {
        const result = output(await tools.execute("grep", { pattern: "needle" }));

        expect({ file, paths: (result.matches as { path: string }[]).map((m) => m.path).sort() }).toEqual({
          file,
          paths: ["docs/readme.md", "src/a.ts", "src/b.ts"],
        });
      } finally {
        rmSync(file, { force: true });
      }
    }
  });

  test("matches case-insensitively only when asked", async () => {
    const strict = output(await tools.execute("grep", { pattern: "NEEDLE" }));

    expect(strict.matches).toEqual([]);

    const loose = output(await tools.execute("grep", { pattern: "NEEDLE", case_insensitive: true }));

    expect((loose.matches as { path: string }[]).map((m) => m.path).sort()).toEqual([
      "docs/readme.md",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  test("keeps the matches found when ripgrep also reports an error", async () => {
    const partial = await registry({
      rgCommand: fakeRg(
        box.base,
        `printf '%s\\000%s\\n' src/a.ts 1:ok\necho 'src/locked.ts: Permission denied (os error 13)' >&2\nexit 2`,
      ),
    });

    expect(output(await partial.execute("grep", { pattern: "x" }))).toEqual({
      matches: [{ path: "src/a.ts", line: 1, text: "ok" }],
      truncated: false,
      warning: "ripgrep reported an error, results may be incomplete: src/locked.ts: Permission denied (os error 13)",
    });

    const silent = await registry({ rgCommand: fakeRg(box.base, "exit 2") });

    expect(output(await silent.execute("grep", { pattern: "x" }))).toEqual({
      matches: [],
      truncated: false,
      warning: "ripgrep reported an error, results may be incomplete: exit 2",
    });

    const crashed = await registry({ rgCommand: fakeRg(box.base, "echo 'rg: out of memory' >&2\nexit 3") });

    expect(errorOf(await crashed.execute("grep", { pattern: "x" }))).toBe("grep failed: rg: out of memory");

    const blankFirst = await registry({
      rgCommand: fakeRg(box.base, "printf '\\n\\nregex parse error\\n' >&2\nexit 2"),
    });

    expect(errorOf(await blankFirst.execute("grep", { pattern: "x" }))).toBe(
      "invalid regex pattern: regex parse error",
    );
  });

  test("never reaches outside files, symlinked targets or .git", async () => {
    for (const pattern of [SECRET, TOKEN, "oauth2"]) {
      const result = output(await tools.execute("grep", { pattern, fixed_strings: true }));

      expect(result.matches).toEqual([]);
    }

    expect((await tools.execute("grep", { pattern: "x", path: "out-dir" })).ok).toBe(false);
    expect((await tools.execute("grep", { pattern: "x", path: ".git" })).ok).toBe(false);
  });

  test("treats flag-like patterns as patterns and refuses flag-like paths", async () => {
    const marker = join(box.base, "pre-ran");

    writeFileSync(join(box.base, "pre.sh"), `#!/bin/sh\ntouch ${marker}\ncat "$1"\n`);
    chmodSync(join(box.base, "pre.sh"), 0o755);
    Bun.spawnSync(["rg", "--pre=../pre.sh", "needle", "src/b.ts"], { cwd: box.repo, env: { PATH: PATH_ENV } });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    for (const pattern of ["--pre=../pre.sh", "-f", "--files", "--pre", "-e"]) {
      const result = await tools.execute("grep", { pattern });

      expect(result.ok).toBe(true);
    }

    expect((await tools.execute("grep", { pattern: "a", path: "--pre=sh" })).ok).toBe(false);
    expect((await tools.execute("grep", { pattern: "a", path: "-f" })).ok).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  test("reports an invalid regular expression as a tool error that says why", async () => {
    const error = errorOf(await tools.execute("grep", { pattern: "(" }));

    expect(error).toStartWith("invalid regex pattern: ");
    expect(error).toContain("unclosed group");
    expect(output(await tools.execute("grep", { pattern: "(", fixed_strings: true })).matches).toEqual([]);
  });

  test("returns matches in path order, so the 200 kept are the same on every run", async () => {
    const dir = join(box.repo, "spread");

    try {
      for (let d = 0; d < 20; d++) {
        mkdirSync(join(dir, `d${d}`), { recursive: true });

        for (let f = 0; f < 20; f++) writeFileSync(join(dir, `d${d}`, `f${f}.txt`), "spot\n".repeat(3));
      }

      const runs: string[] = [];

      for (let i = 0; i < 5; i++) {
        const result = output(await tools.execute("grep", { pattern: "spot", path: "spread" }));

        expect(result.truncated).toBe(true);

        const paths = (result.matches as { path: string; line: number }[]).map((m) => `${m.path}:${m.line}`);
        const sorted = (result.matches as { path: string }[]).map((m) => m.path);

        expect(sorted).toEqual([...sorted].sort());
        runs.push(paths.join("\n"));
      }

      expect(new Set(runs).size).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cuts a long match line without splitting a character and marks the cut", async () => {
    try {
      writeFileSync(
        join(box.repo, "emoji.txt"),
        `${"x".repeat(RepoLimits.GREP_MAX_LINE_CHARS - 1)}\u{1F600}tail\r\nshort tail\r\n`,
      );

      const result = output(await tools.execute("grep", { pattern: "tail", path: "emoji.txt" }));

      expect((result.matches as { text: string }[]).map((m) => m.text)).toEqual([
        `${"x".repeat(RepoLimits.GREP_MAX_LINE_CHARS - 1)}\u{1F600} [... omitted end of long line]`,
        "short tail",
      ]);
    } finally {
      rmSync(join(box.repo, "emoji.txt"), { force: true });
    }
  });

  test("drops every match of a binary file, as a directory walk would skip it", async () => {
    try {
      writeFileSync(
        join(box.repo, "bin-hit.dat"),
        new Uint8Array([...Buffer.from("binhit\n"), 0, 0, ...Buffer.from("binhit\n")]),
      );

      writeFileSync(join(box.repo, "text-hit.txt"), "binhit\n");

      const result = output(await tools.execute("grep", { pattern: "binhit" }));

      expect(result).toEqual({ matches: [{ path: "text-hit.txt", line: 1, text: "binhit" }], truncated: false });

      const direct = output(await tools.execute("grep", { pattern: "binhit", path: "bin-hit.dat" }));

      expect(direct.matches).toEqual([]);
    } finally {
      rmSync(join(box.repo, "bin-hit.dat"), { force: true });
      rmSync(join(box.repo, "text-hit.txt"), { force: true });
    }
  });

  test("keeps path order when a tracked symlink sorts before the file it points to", async () => {
    try {
      symlinkSync("src/b.ts", join(box.repo, "a-link.ts"));

      const result = output(await tools.execute("grep", { pattern: "needle" }));

      expect((result.matches as { path: string }[]).map((m) => m.path)).toEqual([
        "docs/readme.md",
        "src/a.ts",
        "src/b.ts",
      ]);
    } finally {
      rmSync(join(box.repo, "a-link.ts"), { force: true });
    }
  });

  test("a tracked file swapped for an outside symlink after the first call still stays out", async () => {
    const tools = await registry();
    const before = output(await tools.execute("grep", { pattern: "needle" }));

    expect((before.matches as { path: string }[]).map((m) => m.path)).toContain("src/b.ts");

    const file = join(box.repo, "src", "b.ts");

    try {
      rmSync(file);
      symlinkSync(join(box.outside, "secret.txt"), file);

      for (const pattern of [SECRET, "needle", "."]) {
        const result = await tools.execute("grep", { pattern });

        expect(JSON.stringify(result)).not.toContain(SECRET);
      }
    } finally {
      rmSync(file, { force: true });
      writeFileSync(file, "needle\n");
    }
  });

  test("a tracked file deleted from the work tree does not make grep fail", async () => {
    const tools = await registry();
    const file = join(box.repo, "src", "b.ts");

    output(await tools.execute("grep", { pattern: "needle" }));

    try {
      rmSync(file);

      expect(await tools.execute("grep", { pattern: "no-such-text-anywhere" })).toEqual({
        ok: true,
        output: { matches: [], truncated: false },
      });

      const after = output(await tools.execute("grep", { pattern: "needle" }));

      expect(after).toEqual({
        matches: [
          { path: "docs/readme.md", line: 2, text: "needle" },
          { path: "src/a.ts", line: 2, text: "export const needle = 2;" },
        ],
        truncated: false,
      });
    } finally {
      writeFileSync(file, "needle\n");
    }
  });

  test("skips a tracked file over the file size limit, by path and in a directory", async () => {
    const dir = join(box.repo, "big");

    try {
      mkdirSync(dir);

      const filler = `${"y".repeat(1023)}\n`;

      writeFileSync(join(dir, "huge.txt"), `bighit\n${filler.repeat(RepoLimits.MAX_FILE_BYTES / filler.length + 1)}`);
      writeFileSync(join(dir, "small.txt"), "bighit\n");

      const all = output(await tools.execute("grep", { pattern: "bighit", path: "big" }));

      expect(all.matches).toEqual([{ path: "big/small.txt", line: 1, text: "bighit" }]);

      const direct = output(await tools.execute("grep", { pattern: "bighit", path: "big/huge.txt" }));

      expect(direct.matches).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stops at 200 matches and says how to narrow the search", async () => {
    writeFileSync(join(box.repo, "many.txt"), "hit\n".repeat(300));

    const result = output(await tools.execute("grep", { pattern: "hit", path: "many.txt" }));

    expect((result.matches as unknown[]).length).toBe(RepoLimits.GREP_MAX_MATCHES);
    expect(result.truncated).toBe(true);

    expect(result.notice).toBe(
      "(Results are truncated: showing first 200 results. Consider using a more specific path or pattern.)",
    );

    rmSync(join(box.repo, "many.txt"));

    const exact = await registry({
      rgCommand: fakeRg(
        box.base,
        `i=1\nwhile [ $i -le ${RepoLimits.GREP_MAX_MATCHES} ]; do printf '%s\\000%s\\n' src/a.ts "$i:x"; i=$((i+1)); done`,
      ),
    });

    const full = output(await exact.execute("grep", { pattern: "x" }));

    expect((full.matches as unknown[]).length).toBe(RepoLimits.GREP_MAX_MATCHES);
    expect(full.truncated).toBe(false);
    expect(full.notice).toBeUndefined();
  });

  test("truncates when the record past the cap arrives without a trailing newline", async () => {
    const unterminated = await registry({
      rgCommand: fakeRg(
        box.base,
        `i=1\nwhile [ $i -le ${RepoLimits.GREP_MAX_MATCHES} ]; do printf '%s\\000%s\\n' src/a.ts "$i:x"; i=$((i+1)); done\nprintf '%s\\000%s' src/a.ts "${RepoLimits.GREP_MAX_MATCHES + 1}:x"`,
      ),
    });

    const result = output(await unterminated.execute("grep", { pattern: "x" }));

    expect((result.matches as unknown[]).length).toBe(RepoLimits.GREP_MAX_MATCHES);
    expect(result.truncated).toBe(true);

    expect(result.notice).toBe(
      "(Results are truncated: showing first 200 results. Consider using a more specific path or pattern.)",
    );
  });

  test("stops reading a file with millions of matches once 200 are kept", async () => {
    const file = join(box.repo, "flood.txt");

    try {
      writeFileSync(file, "flood\n".repeat(3_000_000));

      const fast = await registry({ timeoutMs: 3000 });
      const started = performance.now();
      const result = output(await fast.execute("grep", { pattern: "flood", path: "flood.txt" }));

      expect(performance.now() - started).toBeLessThan(3000);
      expect((result.matches as unknown[]).length).toBe(200);
      expect(result.truncated).toBe(true);
    } finally {
      rmSync(file, { force: true });
    }
  }, 30_000);

  test("returns at once from a tracked one-line file of 16 MB that matches everywhere", async () => {
    const file = join(box.repo, "bundle.min.js");

    try {
      writeFileSync(file, "var a=1;".repeat(2_000_000));

      const fast = await registry({ timeoutMs: 2500 });
      const result = output(await fast.execute("grep", { pattern: "var" }));

      expect(result.truncated).toBe(false);

      const matches = result.matches as { path: string; line: number; text: string }[];

      expect(matches.map((m) => `${m.path}:${m.line}`)).toEqual(["bundle.min.js:1"]);
      expect(matches[0]?.text).toBe(`${"var a=1;".repeat(62)}var  [... omitted end of long line]`);
    } finally {
      rmSync(file, { force: true });
    }
  }, 30_000);

  test("kills ripgrep after the timeout and drops paths that leave the jail", async () => {
    const slow = await registry({
      rgCommand: fakeRg(box.base, "sleep 5"),
      timeoutMs: 100,
    });

    const started = Date.now();

    expect(errorOf(await slow.execute("grep", { pattern: "x" }))).toContain("timed out");
    expect(Date.now() - started).toBeLessThan(3000);

    const lying = await registry({
      rgCommand: fakeRg(
        box.base,
        `printf '%s\\000%s\\n' ../outside/secret.txt "1:${SECRET}" ./out-file "1:${SECRET}" src/a.ts 1:ok`,
      ),
    });

    expect(output(await lying.execute("grep", { pattern: "x" })).matches).toEqual([
      { path: "src/a.ts", line: 1, text: "ok" },
    ]);
  });

  test("passes only PATH to ripgrep", async () => {
    const envDump = await registry({
      rgCommand: fakeRg(box.base, 'env | grep -v "^PWD=" | grep -v "^SHLVL=" | grep -v "^_=" > ../env.txt'),
    });

    await envDump.execute("grep", { pattern: "x" });

    const lines = (await Bun.file(join(box.base, "env.txt")).text()).trim().split("\n");

    expect(lines).toEqual([`PATH=${PATH_ENV}`]);
  });

  test("walks the directory with no config, no ignore files, no symlinks, no .git and the size limit", async () => {
    const argvDump = await registry({
      rgCommand: fakeRg(box.base, 'for a in "$@"; do printf "%s\\n" "$a"; done > ../argv.txt'),
    });

    const argv = async (input: Record<string, unknown>) => {
      await argvDump.execute("grep", input);

      return (await Bun.file(join(box.base, "argv.txt")).text()).trim().split("\n");
    };

    const root = await argv({ pattern: "-e" });

    expect(root).toContain("--no-config");
    expect(root).toContain("--no-ignore");
    expect(root).toContain("--hidden");
    expect(root).toContain("--iglob=!.git");
    expect(root).toContain(`--max-filesize=${RepoLimits.MAX_FILE_BYTES}`);
    expect(root).toContain(`--max-count=${RepoLimits.GREP_MAX_MATCHES + 1}`);
    expect(root.some((arg) => arg === "-L" || arg === "--follow" || arg.startsWith("--pre"))).toBe(false);
    expect(root.slice(-3)).toEqual(["--", "-e", "."]);
    expect((await argv({ pattern: "x", path: "src" })).slice(-3)).toEqual(["--", "x", "src"]);
    expect((await argv({ pattern: "x", path: "in-link.ts" })).slice(-3)).toEqual(["--", "x", "src/a.ts"]);
  });

  test("ripgrep alone keeps symlinks, .git in any case and oversized files out of a directory walk", async () => {
    const open = await runOf({}, ALL, OPEN);

    const made = [join(box.repo, ".GIT"), join(box.repo, "sub"), join(box.repo, "huge.txt")];

    try {
      mkdirSync(join(box.repo, ".GIT"));
      writeFileSync(join(box.repo, ".GIT", "config"), "case-marker\n");
      mkdirSync(join(box.repo, "sub"));
      writeFileSync(join(box.repo, "sub", ".Git"), "case-marker\n");

      const filler = `${"y".repeat(1023)}\n`;

      writeFileSync(
        join(box.repo, "huge.txt"),
        `case-marker\n${filler.repeat(RepoLimits.MAX_FILE_BYTES / filler.length + 1)}`,
      );

      const grep = toolboxOf([GrepTool], open);

      for (const pattern of [SECRET, TOKEN, "case-marker"]) {
        const result = output(await grep.execute("grep", { pattern, fixed_strings: true }));

        expect({ pattern, matches: result.matches }).toEqual({ pattern, matches: [] });
      }
    } finally {
      for (const path of made) rmSync(path, { recursive: true, force: true });
    }
  });
});

describe("files outside HEAD", () => {
  const LOCAL_SECRET = "LOCAL-ENV-SECRET-5d1e";
  const local: string[] = [];
  let tracked: Session;

  beforeAll(async () => {
    const committed = [...trackedPaths(box.repo), "env-link"];

    writeFileSync(join(box.repo, ".env"), `API_KEY=${LOCAL_SECRET}\n`);
    symlinkSync(".env", join(box.repo, "env-link"));
    mkdirSync(join(box.repo, "aaa-deps"));

    for (let i = 0; i < ToolLimits.GLOB_MAX_RESULTS + 5; i++) {
      writeFileSync(join(box.repo, "aaa-deps", `d${i}.ts`), "needle\n".repeat(3));
    }

    local.push(".env", "env-link", "aaa-deps");
    tracked = await registry({ tracked: committed });
  });

  afterAll(() => {
    for (const path of local) rmSync(join(box.repo, path), { recursive: true, force: true });
  });

  test("read_file refuses an untracked file and a tracked link to one, as if they did not exist", async () => {
    expect(errorOf(await tracked.execute("read_file", { path: ".env" }))).toBe("path does not exist");
    expect(errorOf(await tracked.execute("read_file", { path: "env-link" }))).toBe("path does not exist");
    expect(errorOf(await tracked.execute("read_file", { path: "aaa-deps/d0.ts" }))).toBe("path does not exist");
    expect(output(await tracked.execute("read_file", { path: "src/a.ts" })).path).toBe("src/a.ts");
  });

  test("list_dir shows only tracked entries and refuses an untracked directory", async () => {
    const names = (output(await tracked.execute("list_dir", {})).entries as { name: string }[]).map((e) => e.name);

    expect(names).toContain("src");
    expect(names).toContain("env-link");
    expect(names).not.toContain(".env");
    expect(names).not.toContain("aaa-deps");
    expect(errorOf(await tracked.execute("list_dir", { path: "aaa-deps" }))).toBe("path does not exist");
  });

  test("glob returns tracked files although untracked ones would fill the cap first", async () => {
    expect(output(await tracked.execute("glob", { pattern: "**/*.ts" }))).toEqual({
      files: ["src/a.ts", "src/b.ts"],
      truncated: false,
    });

    expect(errorOf(await tracked.execute("glob", { pattern: "*", path: "aaa-deps" }))).toBe("path does not exist");
    expect(output(await tracked.execute("glob", { pattern: "**/.env" })).files).toEqual([]);
  });

  test("grep searches tracked files only, so ignored secrets and untracked matches stay out", async () => {
    const found = output(await tracked.execute("grep", { pattern: "needle" }));

    expect((found.matches as { path: string }[]).map((m) => m.path)).toEqual([
      "docs/readme.md",
      "src/a.ts",
      "src/b.ts",
    ]);

    expect(found.truncated).toBe(false);
    expect(output(await tracked.execute("grep", { pattern: LOCAL_SECRET, fixed_strings: true })).matches).toEqual([]);
    expect(errorOf(await tracked.execute("grep", { pattern: "x", path: ".env" }))).toBe("path does not exist");
    expect(errorOf(await tracked.execute("grep", { pattern: "x", path: "aaa-deps" }))).toBe("path does not exist");
  });

  test("grep does not pass off an untracked file whose name holds a newline as the tracked file it names", async () => {
    const names = [
      Buffer.from("q\nsrc"),
      Buffer.from("q\n\uFEFFsrc"),
      ...(process.platform === "linux"
        ? [Buffer.concat([Buffer.from("q"), Buffer.from([0xff]), Buffer.from("\nsrc")])]
        : []),
    ];

    const dirs = names.map((name) => Buffer.concat([Buffer.from(`${box.repo}/`), name]));

    try {
      for (const dir of dirs) {
        mkdirSync(dir);
        writeFileSync(Buffer.concat([dir, Buffer.from("/b.ts")]), `${LOCAL_SECRET}\n`);
      }

      expect(output(await tracked.execute("grep", { pattern: LOCAL_SECRET })).matches).toEqual([]);

      expect(output(await tracked.execute("grep", { pattern: "needle", path: "src" })).matches).toEqual([
        { path: "src/a.ts", line: 2, text: "export const needle = 2;" },
        { path: "src/b.ts", line: 1, text: "needle" },
      ]);
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("read-only proof", () => {
  test("a run of hostile calls leaves the repository and its surroundings byte for byte unchanged", async () => {
    const before = treeHash(box.base);

    const hostile: [string, unknown][] = [
      ["shell", { command: "rm -rf ." }],
      ["write_file", { path: "src/a.ts", content: "pwned" }],
      ["fetch_url", { url: "https://example.invalid" }],
      ["read_file", { path: "../outside/secret.txt" }],
      ["read_file", { path: ".git/config" }],
      ["read_file", { path: "out-file" }],
      ["read_file", { path: "git-link" }],
      ["list_dir", { path: ".." }],
      ["list_dir", { path: ".git" }],
      ["glob", { pattern: "../**" }],
      ["glob", { pattern: "**/*" }],
      ["grep", { pattern: "--pre=../pre.sh" }],
      ["grep", { pattern: "-f", path: "src" }],
      ["grep", { pattern: TOKEN }],
      ["grep", { pattern: "a", path: "--files-with-matches" }],
      ["read_file", { path: "src/a.ts", start_line: 1, end_line: 1 }],
    ];

    const outputs: string[] = [];

    for (const [name, input] of hostile) outputs.push(JSON.stringify(await tools.execute(name, input)));

    expect(treeHash(box.base)).toBe(before);

    const all = outputs.join("\n");

    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(TOKEN);
  });
});
