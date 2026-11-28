import { fileURLToPath, pathToFileURL } from "node:url";
import type { Loader, LoaderContext } from "astro/loaders";
import { DOC_ORDER } from "../navigation.ts";
import { DocPages } from "./DocPages.ts";
import { Repository } from "./Repository.ts";

function repositoryOf(context: LoaderContext): Repository {
  return new Repository(fileURLToPath(new URL("../", context.config.root)));
}

function watch(context: LoaderContext, repository: Repository, reload: () => Promise<void>): void {
  const watcher = context.watcher;

  if (watcher === undefined) return;

  const watched = [repository.absolute(DocPages.DIRECTORY), repository.absolute(DocPages.README)];

  const onChange = (changed: string): void => {
    if (!watched.some((path) => changed === path || changed.startsWith(`${path}/`))) return;

    reload().then(
      () => context.logger.info(`Reloaded ${repository.pathOf(changed) ?? changed}`),
      (error: unknown) => context.logger.error(error instanceof Error ? error.message : String(error)),
    );
  };

  for (const path of watched) watcher.add(path);

  for (const event of ["add", "change", "unlink"] as const) watcher.on(event, onChange);
}

async function loadDocs(context: LoaderContext, repository: Repository): Promise<void> {
  const entries = [];
  const pages = new DocPages(repository).all();
  const unlisted = pages.find((page) => !DOC_ORDER.includes(page.id));

  if (unlisted !== undefined) {
    throw new Error(
      `${unlisted.source}: add "${unlisted.id}" to DOC_ORDER in website/src/navigation.ts, so that the page gets a place in the sidebar`,
    );
  }

  for (const page of pages) {
    const file = repository.absolute(page.source);
    const rendered = await context.renderMarkdown(`---\nslug: ${page.id}\n---\n\n${page.body}`, {
      fileURL: pathToFileURL(file),
    });

    const data = await context.parseData({
      id: page.id,
      data: { title: page.title, editUrl: repository.editUrl(page.source) },
      filePath: file,
    });

    entries.push({
      id: page.id,
      data,
      body: page.body,
      filePath: `../${page.source}`,
      digest: context.generateDigest(`${page.title}\n${page.body}`),
      rendered,
    });
  }

  context.store.clear();

  for (const entry of entries) context.store.set(entry);
}

async function loadLandingFacts(context: LoaderContext, repository: Repository): Promise<void> {
  const facts = new DocPages(repository).landingFacts();
  const data = await context.parseData({ id: "landing", data: { ...facts } });

  context.store.clear();
  context.store.set({ id: "landing", data, digest: context.generateDigest(JSON.stringify(facts)) });
}

export function repositoryDocsLoader(): Loader {
  return {
    name: "kerpeten-repository-docs",
    load: async (context) => {
      const repository = repositoryOf(context);

      await loadDocs(context, repository);
      watch(context, repository, () => loadDocs(context, repository));
    },
  };
}

export function readmeLoader(): Loader {
  return {
    name: "kerpeten-readme",
    load: async (context) => {
      const repository = repositoryOf(context);

      await loadLandingFacts(context, repository);
      watch(context, repository, () => loadLandingFacts(context, repository));
    },
  };
}
