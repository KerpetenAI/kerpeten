/**
 * The entries `glab api --paginate --output ndjson` printed: one JSON value per line, every line ended by a newline.
 * When glab stopped part-way, the text ends in a line without a newline, the cut entry or the error body of the page
 * that failed; that tail is no entry and `whole` is false. A line that is no JSON is left out and makes `whole` false
 * too. An empty text is a list without entries.
 */
export class JsonLines {
  public readonly items: readonly unknown[];
  public readonly whole: boolean;

  private constructor(items: readonly unknown[], whole: boolean) {
    this.items = items;
    this.whole = whole;
  }

  public static read(text: string): JsonLines {
    const lines = text.split("\n");
    const tail = lines.pop() ?? "";
    const items: unknown[] = [];
    let whole = tail === "";

    for (const line of lines) {
      try {
        items.push(JSON.parse(line));
      } catch {
        whole = false;
      }
    }

    return new JsonLines(items, whole);
  }
}
