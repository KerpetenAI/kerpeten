---
"kerpeten": minor
---

`kerpeten review --dry-run --mr <n>` reviews GitHub pull request `n` of the repository the `origin` remote names: it reads the pull request with the GitHub CLI (`gh`) and gives the reviewer its title and description. The working copy must be at the last commit of the pull request, and nothing is posted to it yet.
