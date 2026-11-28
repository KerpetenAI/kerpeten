# Website

The website of Kerpeten, built with [Astro](https://astro.build) and [Starlight](https://starlight.astro.build). The `site` workflow builds it on a pull request and publishes it to GitHub Pages, at `https://kerpeten.sh`, on a push to `master`.

## Run it

You need [Bun](https://bun.sh) 1.4.5 and Node.js 22 or later. The website has its own dependencies, apart from the ones of the CLI:

```sh
cd website
bun install
bun run dev
```

`bun run build` writes the site to `website/dist/` and stops on a broken link. `bun run preview` serves that folder.

## Where the pages come from

No page of the docs is written twice. The build reads the files of the repository:

- `/docs/<name>/` is `docs/<name>.md`. Its first line, the `# ` heading, becomes the title of the page. The files need no frontmatter.
- `/docs/`, the Getting started page, is put together from sections of the root `README.md`: the status note, `Quick start`, `Models`, `How it works`, `Commands` and `Platforms`.
- `/`, the landing page, is `src/pages/index.astro`. Its status note, its commands and its sample output are read from the root `README.md`.

Write links the way they work on GitHub, such as `[Configuration](configuration.md#limits)` or `[RELEASING.md](../RELEASING.md)`. The build turns a link to a docs file into the address of its page and a link to another file of the repository into its address on GitHub. It stops when the file is not there, and the links check stops it when a page or a heading is not there.

The code that reads the repository is in `src/source/`.

## Add a docs page

1. Add `docs/<name>.md`. The name is lower-case letters, digits and `-`; the first line is `# Title`.
2. Add `"docs/<name>"` to `DOC_ORDER` in `src/navigation.ts`, at the place it should have in the sidebar.
