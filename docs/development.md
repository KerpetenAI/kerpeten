# Development

To work on Kerpeten itself you need [Bun](https://bun.sh) 1.4.5. Install the dependencies once, in this repository:

```sh
bun install
```

## From source

`scripts/kerpeten.ts` runs the CLI from source, without a build, from any directory:

```sh
bun /path/to/kerpeten/scripts/kerpeten.ts review --dry-run
```

`bun run build -- --target linux-x64` writes a standalone binary to `dist/`, which also runs from any directory.

Do not start `src/cli/main.ts` directly from another directory: Bun takes the decorator dialect from the `tsconfig.json` of the working directory, and the CLI needs the `experimentalDecorators` setting of this repository's. The launcher passes it with `--tsconfig-override`; the binary has it compiled in.

## Checks and builds

```sh
bun run check
bun run build -- --target linux-x64
```

`check` runs the linter, the type check, the tests and the source layout rules. `build` writes a standalone binary to `dist/`; the targets are `linux-x64`, `linux-arm64` and `darwin-arm64`.

`bun run npm-packages` writes the npm packages to `dist/npm/`: the `kerpeten` package with the launcher, and one `@kerpetensh/kerpeten-<target>` package with the binary of each target. `bun run npm-smoke` installs them with npm into an empty directory and runs the installed command. [RELEASING.md](../RELEASING.md) tells how a version gets to npm.

## Changesets

A pull request that changes what a user of `kerpeten` gets adds a changeset: a small file under `.changeset/` that names the bump (`patch`, `minor` or `major`) and describes the change. `bun run changeset` writes it from a few questions, and [.changeset/README.md](../.changeset/README.md) shows how to write it by hand. The version in `package.json` is never edited by hand: the `release` workflow raises it from these files.
