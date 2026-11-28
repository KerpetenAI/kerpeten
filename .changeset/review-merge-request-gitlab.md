---
"kerpeten": minor
---

`kerpeten review --dry-run --mr <n>` also reviews a GitLab merge request, read through the GitLab CLI (`glab`). The pull request or merge request is read from the project of the `origin` remote. The platform comes from the host of that remote (`github.com` or `gitlab.com`); for any other host, set the new `platform: github | gitlab` key in `.kerpeten.yml`.
