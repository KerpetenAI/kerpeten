import type { SectionedText, TitledText } from "./types/source.ts";

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

const TITLE = /^# +(\S.*)$/;

const SECTION = /^## +(\S.*)$/;

export function splitTitle(source: string, text: string): TitledText {
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  const match = TITLE.exec(lines[first] ?? "");

  if (match?.[1] === undefined) {
    throw new Error(`${source}: the first line must be a "# " heading, because it becomes the title of the page`);
  }

  return {
    title: match[1].trim(),
    body: lines
      .slice(first + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
}

export function splitSections(text: string): SectionedText {
  const preamble: string[] = [];
  const sections = new Map<string, string[]>();
  let current = preamble;
  let fence: string | undefined;

  for (const line of text.split("\n")) {
    const marker = FENCE.exec(line)?.[1];

    if (fence === undefined && marker !== undefined) {
      fence = marker;
    } else if (fence !== undefined && marker?.startsWith(fence) === true) {
      fence = undefined;
    }

    const heading = fence === undefined ? SECTION.exec(line)?.[1] : undefined;

    if (heading === undefined) {
      current.push(line);
    } else {
      current = [];
      sections.set(heading.trim(), current);
    }
  }

  return {
    preamble: preamble.join("\n").trim(),
    sections: new Map([...sections].map(([name, lines]) => [name, lines.join("\n").trim()])),
  };
}

export function codeBlocks(text: string, language: string): string[] {
  const blocks: string[] = [];
  let open: { fence: string; indent: number; lines: string[]; wanted: boolean } | undefined;

  for (const line of text.split("\n")) {
    const match = FENCE.exec(line);

    if (open === undefined) {
      if (match?.[1] !== undefined) {
        open = {
          fence: match[1],
          indent: line.length - line.trimStart().length,
          lines: [],
          wanted: (match[2] ?? "").trim() === language,
        };
      }
    } else if (match?.[1]?.startsWith(open.fence) === true && (match[2] ?? "").trim() === "") {
      if (open.wanted) blocks.push(open.lines.join("\n"));

      open = undefined;
    } else {
      open.lines.push(line.slice(Math.min(open.indent, line.length - line.trimStart().length)));
    }
  }

  return blocks;
}

export function quoteLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .join("\n");
}
