#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");

const BINARY = "bin/kerpeten";
const NAME_PREFIX = "kerpeten-";

function usesMusl(platform, readReport) {
  if (platform !== "linux") return false;

  return readReport()?.header?.glibcVersionRuntime === undefined;
}

function resolveBinary(names, platform, arch, musl, resolve) {
  const target = `${platform}-${arch}`;
  const name = names.find((candidate) => candidate.endsWith(`/${NAME_PREFIX}${target}`));

  if (name === undefined) {
    const builds = names.map((candidate) => candidate.slice(candidate.lastIndexOf(NAME_PREFIX) + NAME_PREFIX.length));

    return { ok: false, error: `there is no build for ${target}; the builds are ${builds.join(", ")}` };
  }

  if (musl) {
    return { ok: false, error: "this Linux uses musl libc, as Alpine does; the builds need glibc" };
  }

  try {
    return { ok: true, path: resolve(`${name}/${BINARY}`) };
  } catch {
    return {
      ok: false,
      error: `the package ${name} is not installed; it is an optional dependency, so install kerpeten again without --omit=optional`,
    };
  }
}

function main() {
  const names = Object.keys(require("../package.json").optionalDependencies);
  const musl = usesMusl(process.platform, () => process.report.getReport());
  const binary = resolveBinary(names, process.platform, process.arch, musl, require.resolve);

  if (!binary.ok) {
    console.error(`kerpeten: ${binary.error}`);
    process.exit(1);
  }

  const result = spawnSync(binary.path, process.argv.slice(2), { stdio: "inherit" });

  if (result.error !== undefined) {
    console.error(`kerpeten: cannot start ${binary.path}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.signal !== null) {
    process.exitCode = 1;
    process.kill(process.pid, result.signal);

    return;
  }

  process.exit(result.status ?? 1);
}

if (require.main === module) main();

module.exports = { resolveBinary, usesMusl };
