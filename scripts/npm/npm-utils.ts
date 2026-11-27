import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { buildBinary } from "../build/build-utils.ts";
import { Targets } from "../build/Targets.ts";
import type { Target } from "../build/types/build.ts";
import type { BinaryBuilder, CommandResult, Manifest, PackageMeta, Platform } from "./types/npm.ts";

const MAIN_PACKAGE = "kerpeten";

const SCOPE = "@kerpetensh";

const REPOSITORY = { type: "git", url: "git+https://github.com/KerpetenSH/kerpeten.git" } as const;

const HOMEPAGE = "https://github.com/KerpetenSH/kerpeten";

const KEYWORDS: readonly string[] = ["code-review", "cli", "ai", "review"];

const LAUNCHER = "kerpeten.cjs";

const BINARY = "kerpeten";

const EXECUTABLE = 0o755;

const PLATFORMS: Readonly<Record<Target, Platform>> = {
  "linux-x64": { os: "linux", cpu: "x64", libc: "glibc" },
  "linux-arm64": { os: "linux", cpu: "arm64", libc: "glibc" },
  "darwin-arm64": { os: "darwin", cpu: "arm64" },
};

export function platformPackage(target: Target): string {
  return `${SCOPE}/${MAIN_PACKAGE}-${target}`;
}

export function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, "").replace("/", "-")}-${version}.tgz`;
}

export function readMeta(root: string): PackageMeta {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>;

  const text = (field: string): string => {
    const value = manifest[field];

    if (typeof value !== "string" || value === "") throw new Error(`package.json has no ${field}`);

    return value;
  };

  return {
    version: text("version"),
    description: text("description"),
    license: text("license"),
    author: text("author"),
  };
}

export function mainManifest(meta: PackageMeta): Manifest {
  return {
    name: MAIN_PACKAGE,
    version: meta.version,
    description: meta.description,
    license: meta.license,
    author: meta.author,
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    keywords: KEYWORDS,
    bin: { [MAIN_PACKAGE]: `bin/${LAUNCHER}` },
    files: ["bin"],
    engines: { node: ">=18" },
    optionalDependencies: Object.fromEntries(Targets.ALL.map((target) => [platformPackage(target), meta.version])),
  };
}

export function platformManifest(target: Target, meta: PackageMeta): Manifest {
  const platform = PLATFORMS[target];

  return {
    name: platformPackage(target),
    version: meta.version,
    description: `The ${target} build of ${MAIN_PACKAGE}. Install ${MAIN_PACKAGE} instead of this package.`,
    license: meta.license,
    author: meta.author,
    homepage: HOMEPAGE,
    repository: REPOSITORY,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.libc === undefined ? {} : { libc: [platform.libc] }),
    files: ["bin"],
    publishConfig: { access: "public" },
  };
}

function packageDir(root: string, target?: Target): string {
  return join(root, "dist", "npm", target === undefined ? MAIN_PACKAGE : `${MAIN_PACKAGE}-${target}`);
}

function startPackage(root: string, dir: string, manifest: Manifest, readme: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, "README.md"), readme);
  copyFileSync(join(root, "LICENSE"), join(dir, "LICENSE"));
}

/**
 * Writes the packages to publish under `dist/npm`: the main package with the launcher, and one package with the
 * binary for each given target. The main package always names every target, also the ones not built now.
 */
export function writePackages(root: string, targets: readonly Target[], build: BinaryBuilder = buildBinary): string[] {
  const meta = readMeta(root);
  const main = packageDir(root);

  startPackage(root, main, mainManifest(meta), readFileSync(join(root, "README.md"), "utf8"));
  copyFileSync(join(root, "npm", LAUNCHER), join(main, "bin", LAUNCHER));
  chmodSync(join(main, "bin", LAUNCHER), EXECUTABLE);

  const dirs = [main];

  for (const target of targets) {
    const dir = packageDir(root, target);
    const manifest = platformManifest(target, meta);

    startPackage(root, dir, manifest, `# ${platformPackage(target)}\n\n${String(manifest.description)}\n`);
    build(root, target, join(dir, "bin", BINARY));
    chmodSync(join(dir, "bin", BINARY), EXECUTABLE);
    dirs.push(dir);
  }

  return dirs;
}

function command(argv: readonly string[], cwd: string): CommandResult {
  const result = Bun.spawnSync([...argv], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });

  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function must(argv: readonly string[], cwd: string, code = 0): CommandResult {
  const result = command(argv, cwd);

  if (result.code !== code) {
    throw new Error(
      `${argv.join(" ")} ended with ${result.code}, expected ${code}: ${(result.err || result.out).trim()}`,
    );
  }

  return result;
}

/** Packs one package directory with `npm pack` into a directory and gives the path of the tarball. */
export function packPackage(dir: string, name: string, version: string, destination: string): string {
  mkdirSync(destination, { recursive: true });
  must(["npm", "pack", "--pack-destination", destination], dir);

  const tarball = join(destination, tarballName(name, version));

  if (!existsSync(tarball)) throw new Error(`npm pack of ${dir} did not write ${tarball}`);

  return tarball;
}

function parseTargets(values: readonly string[] | undefined, label: string): Target[] | undefined {
  const targets: Target[] = [];

  for (const value of values ?? Targets.ALL) {
    if (!Targets.is(value)) {
      console.error(`${label}: unknown target ${value}; expected one of ${Targets.ALL.join(", ")}`);

      return undefined;
    }

    targets.push(value);
  }

  return targets;
}

export function runNpmPackages(root: string, args: readonly string[]): number {
  const parsed = parseArgs({
    args: [...args],
    options: { target: { type: "string", multiple: true }, pack: { type: "string" } },
  });

  const targets = parseTargets(parsed.values.target, "npm-packages");

  if (targets === undefined) return 2;

  for (const dir of writePackages(root, targets)) console.log(`npm-packages: ${dir}`);

  const destination = parsed.values.pack;

  if (destination === undefined) return 0;

  const { version } = readMeta(root);

  console.log(`npm-packages: ${packPackage(packageDir(root), MAIN_PACKAGE, version, destination)}`);

  for (const target of targets) {
    console.log(
      `npm-packages: ${packPackage(packageDir(root, target), platformPackage(target), version, destination)}`,
    );
  }

  return 0;
}

function hostTarget(): string {
  return `${process.platform}-${process.arch}`;
}

function checkExecutable(tarball: string, path: string): void {
  const listing = must(["tar", "-tvf", tarball], tmpdir()).out.split("\n");
  const line = listing.find((entry) => entry.endsWith(` package/${path}`));

  if (line === undefined) throw new Error(`${tarball} has no ${path}`);
  if (!line.startsWith("-rwx")) throw new Error(`${path} in ${tarball} is not executable: ${line}`);
}

/**
 * Installs the main package and the package of one target from their tarballs into an empty directory with npm, and
 * runs the installed command: `self-check` must pass and an unknown command must end with 2. The tarballs come from a
 * directory, or are packed from `dist/npm` first.
 */
export function smokeTest(root: string, target: Target, tarballs: string | undefined): void {
  const { version } = readMeta(root);
  const work = mkdtempSync(join(tmpdir(), "kerpeten-npm-smoke-"));

  try {
    const from = tarballs ?? join(work, "tarballs");

    if (tarballs === undefined) {
      for (const dir of [packageDir(root), packageDir(root, target)]) {
        if (!existsSync(dir))
          throw new Error(`${dir} is missing; run bun run npm-packages -- --target ${target} first`);
      }

      packPackage(packageDir(root), MAIN_PACKAGE, version, from);
      packPackage(packageDir(root, target), platformPackage(target), version, from);
    }

    const main = join(from, tarballName(MAIN_PACKAGE, version));
    const platform = join(from, tarballName(platformPackage(target), version));

    for (const tarball of [main, platform]) {
      if (!existsSync(tarball)) throw new Error(`${tarball} is missing`);
    }

    checkExecutable(main, `bin/${LAUNCHER}`);
    checkExecutable(platform, `bin/${BINARY}`);

    const prefix = join(work, "prefix");

    mkdirSync(prefix);
    must(["npm", "install", "--prefix", prefix, "--no-audit", "--no-fund", "--no-package-lock", main, platform], work);

    const installed = join(prefix, "node_modules", ".bin", MAIN_PACKAGE);

    must([installed, "self-check"], work);
    must([installed, "no-such-command"], work, 2);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function runNpmSmoke(root: string, args: readonly string[]): number {
  const parsed = parseArgs({ args: [...args], options: { target: { type: "string" }, tarballs: { type: "string" } } });
  const targets = parseTargets([parsed.values.target ?? hostTarget()], "npm-smoke");

  if (targets === undefined) return 2;

  for (const target of targets) {
    try {
      smokeTest(root, target, parsed.values.tarballs);
    } catch (error) {
      console.error(`npm-smoke: ${error instanceof Error ? error.message : String(error)}`);

      return 1;
    }

    console.log(`npm-smoke: ${target} installs and runs`);
  }

  return 0;
}
