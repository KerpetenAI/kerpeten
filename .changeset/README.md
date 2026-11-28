# Changesets

A file in this folder says that the next version of Kerpeten carries a change. `RELEASING.md` tells how these files become a version on npm.

A pull request that changes what a user of `kerpeten` gets adds one file here, with any name that ends in `.md`:

```md
---
"kerpeten": minor
---

`kerpeten init` asks a few questions and writes `.kerpeten.yml`.
```

- `patch` for a fix, `minor` for something new or a changed behaviour, `major` for a change that breaks how people use Kerpeten today.
- The text goes into `CHANGELOG.md` as it is. Write it for a user: what is new or different, in one or two sentences.
- A pull request that changes only tests, documents or the build needs no file.

`bun run changeset` asks the same questions in the terminal and writes the file.
