# Releasing

Kerpeten is published to npm as four packages with one version:

- `kerpeten`: the launcher. It is the package people install.
- `@kerpetensh/kerpeten-linux-x64`, `@kerpetensh/kerpeten-linux-arm64`, `@kerpetensh/kerpeten-darwin-arm64`: one binary each. `kerpeten` lists them as optional dependencies, pinned to its own version, and npm installs the one that fits the machine.

The version is the `version` in `package.json`. That file stays `private`; the published manifests are generated into `dist/npm/`.

## A release

1. Set the new `version` in `package.json` in a pull request and merge it.
2. Tag the merge commit `v<version>`, for example `v0.2.0`, and push the tag.
3. The `release` workflow runs the same jobs as every pull request: the checks, the four tarballs, and an install of those tarballs with npm on Linux x64, Linux arm64 and macOS arm64. Then it publishes the same tarballs: the platform packages first, `kerpeten` last. It stops when the tag is not the version in `package.json`. A package version that is already on npm is skipped, so a failed run can be started again.

The workflow has no npm token. It publishes through npm trusted publishing, which works only for a package that already exists on npm and names this repository and `release.yml` as its trusted publisher. So the first version is published by hand.

## The first version, once

Publish the tarballs that CI built and ran on all three platforms, not ones built on your machine.

1. Find the `ci` run of the commit to release on `master` and download its tarballs:

   ```sh
   gh run list --workflow ci --branch master --limit 1
   gh run download <run-id> --name npm-tarballs --dir tarballs
   ```

2. Sign in: `npm login`.
3. Publish the platform packages, then the main package:

   ```sh
   cd tarballs
   for tarball in kerpetensh-kerpeten-*.tgz kerpeten-*.tgz; do npm publish "$tarball" --access public; done
   ```

4. On npmjs.com, open the settings of each of the four packages and add a trusted publisher: GitHub Actions, organization `KerpetenSH`, repository `kerpeten`, workflow `release.yml`. Do this shortly before the next release: npm drops a new trusted publisher that has not published within 2 days.
