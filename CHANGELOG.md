# kerpeten

## 0.2.0

### Minor Changes

- 9c5e210: `kerpeten review --dry-run --mr <n>` now shows a comment plan: which findings would become comments on lines of the diff, which would go to the one summary comment and which are already written on the pull request, with the exact text of every comment in `--json`. Nothing is posted yet.
- 63e3da8: Review comments are in English when `.kerpeten.yml` does not set `comment_language`. They were in Turkish before; add `comment_language: tr` to keep that.
- 63e3da8: `kerpeten init` asks for the provider and the model of the reviewer and of the judge and for the language of the review comments, writes `.kerpeten.yml` to the root of the repository and tells what is still missing: ripgrep, a key or a ChatGPT sign-in. It never changes a `.kerpeten.yml` that is already there.
- 02be16a: `kerpeten review --dry-run --mr <n>` also reviews a GitLab merge request, read through the GitLab CLI (`glab`). The pull request or merge request is read from the project of the `origin` remote. The platform comes from the host of that remote (`github.com` or `gitlab.com`); for any other host, set the new `platform: github | gitlab` key in `.kerpeten.yml`.
- f97fed3: `kerpeten review --dry-run --mr <n>` reviews GitHub pull request `n` of the repository the `origin` remote names: it reads the pull request with the GitHub CLI (`gh`) and gives the reviewer its title and description. The working copy must be at the last commit of the pull request, and nothing is posted to it yet.
