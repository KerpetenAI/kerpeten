import { codeBlocks, quoteLines, splitSections, splitTitle } from "./markdown-utils.ts";
import type { Repository } from "./Repository.ts";
import type { DocPage, LandingFacts } from "./types/source.ts";

export class DocPages {
  public static readonly DIRECTORY = "docs";

  public static readonly README = "README.md";

  private static readonly FILE = /^docs\/([a-z0-9][a-z0-9-]*)\.md$/;

  private static readonly GETTING_STARTED_SECTIONS: readonly string[] = [
    "Models",
    "How it works",
    "Commands",
    "Platforms",
  ];

  private readonly repository: Repository;

  public constructor(repository: Repository) {
    this.repository = repository;
  }

  public static idOf(path: string): string | undefined {
    const name = DocPages.FILE.exec(path)?.[1];

    return name === undefined ? undefined : `${DocPages.DIRECTORY}/${name}`;
  }

  public all(): DocPage[] {
    return [this.gettingStarted(), ...this.files().map((path) => this.page(path))];
  }

  public landingFacts(): LandingFacts {
    const { preamble } = splitSections(this.repository.read(DocPages.README));
    const sample = this.readmeSection("What a review looks like");
    const output = codeBlocks(sample, "text")[0];
    const caption = sample.split("\n")[0]?.trim() ?? "";
    const commands = codeBlocks(this.readmeSection("Quick start"), "sh").flatMap((block) => block.split("\n"));
    const status = quoteLines(preamble)
      .split("\n")
      .map((line) => line.replace(/^>\s?/, ""))
      .join(" ")
      .replace(/^\*\*Status:\*\*\s*/, "")
      .trim();

    if (output === undefined || caption === "" || caption.startsWith("```")) {
      throw new Error(
        `${DocPages.README}: the section "## What a review looks like" must be a sentence and then a \`\`\`text block; the landing page shows both`,
      );
    }

    if (commands.length === 0) {
      throw new Error(
        `${DocPages.README}: the section "## Quick start" has no \`\`\`sh block; the landing page shows its commands`,
      );
    }

    return { status: status === "" ? undefined : status, commands, sampleCaption: caption, sampleOutput: output };
  }

  private files(): string[] {
    const files = this.repository.list(DocPages.DIRECTORY).filter((path) => path.endsWith(".md"));

    for (const path of files) {
      if (DocPages.idOf(path) === undefined) {
        throw new Error(
          `${path}: a docs file name is lower-case letters, digits and "-", because it becomes the address`,
        );
      }
    }

    return files;
  }

  private page(path: string): DocPage {
    const { title, body } = splitTitle(path, this.repository.read(path));

    return { id: DocPages.idOf(path) ?? path, title, body, source: path };
  }

  private gettingStarted(): DocPage {
    const { preamble } = splitSections(this.repository.read(DocPages.README));
    const parts = [quoteLines(preamble), this.readmeSection("Quick start")];

    for (const name of DocPages.GETTING_STARTED_SECTIONS) parts.push(`## ${name}\n\n${this.readmeSection(name)}`);

    return {
      id: DocPages.DIRECTORY,
      title: "Getting started",
      body: parts.filter((part) => part !== "").join("\n\n"),
      source: DocPages.README,
    };
  }

  private readmeSection(name: string): string {
    const section = splitSections(this.repository.read(DocPages.README)).sections.get(name);

    if (section === undefined || section === "") {
      throw new Error(`${DocPages.README}: the section "## ${name}" is missing or empty; the website is built from it`);
    }

    return section;
  }
}
