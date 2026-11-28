/**
 * The entries `gh api --paginate --slurp` printed: one JSON array whose elements are the pages, each an array of
 * entries. When gh stopped part-way the text is cut, so it is no JSON; then the pages that stand whole before the cut
 * are kept and `whole` is false. Anything that is no page, such as an error body, is left out and makes `whole` false.
 */
export class SlurpedPages {
  public readonly items: readonly unknown[];
  public readonly whole: boolean;

  private constructor(items: readonly unknown[], whole: boolean) {
    this.items = items;
    this.whole = whole;
  }

  public static read(text: string): SlurpedPages {
    const parsed = SlurpedPages.parse(text);

    if (Array.isArray(parsed)) return SlurpedPages.of(parsed, true);

    return SlurpedPages.of(
      SlurpedPages.elements(text).map((element) => SlurpedPages.parse(element)),
      false,
    );
  }

  private static of(elements: readonly unknown[], whole: boolean): SlurpedPages {
    const pages = elements.filter((element) => Array.isArray(element));

    return new SlurpedPages(pages.flat(), whole && pages.length === elements.length);
  }

  private static parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  /** The text of each array or object that stands whole, one level inside the outer array. */
  private static elements(text: string): string[] {
    const found: string[] = [];
    const open = text.search(/\S/);

    if (text[open] !== "[") return found;

    let depth = 0;
    let start = 0;
    let inString = false;
    let escaped = false;

    for (let at = open + 1; at < text.length; at++) {
      const char = text[at];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === "[" || char === "{") {
        if (depth === 0) start = at;

        depth++;
      } else if (char === "]" || char === "}") {
        if (depth === 0) break;

        depth--;

        if (depth === 0) found.push(text.slice(start, at + 1));
      }
    }

    return found;
  }
}
