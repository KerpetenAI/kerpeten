import { type Node, type SourceFile, type Statement, SyntaxKind } from "typescript/unstable/ast";
import {
  isBlock,
  isCaseClause,
  isClassDeclaration,
  isClassExpression,
  isDefaultClause,
  isModuleBlock,
  isPropertyDeclaration,
} from "typescript/unstable/ast/is";
import type { BlankLineViolation } from "./types/check.ts";

export class BlankLines {
  private static readonly MODULE_KINDS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.ImportDeclaration,
    SyntaxKind.ImportEqualsDeclaration,
    SyntaxKind.ExportDeclaration,
  ]);

  private static readonly CONTROL_KINDS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.IfStatement,
    SyntaxKind.ForStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.DoStatement,
    SyntaxKind.SwitchStatement,
    SyntaxKind.TryStatement,
    SyntaxKind.LabeledStatement,
  ]);

  private static readonly EXIT_KINDS: ReadonlySet<SyntaxKind> = new Set([
    SyntaxKind.ReturnStatement,
    SyntaxKind.ThrowStatement,
  ]);

  private static readonly GENERATED = /\.generated\.ts$|\.d\.ts$/;

  private readonly text: string;
  private readonly inserts: number[] = [];
  private readonly found: BlankLineViolation[] = [];

  public constructor(
    private readonly file: string,
    private readonly source: SourceFile,
  ) {
    this.text = source.text;
  }

  public static checks(path: string): boolean {
    return !BlankLines.GENERATED.test(path);
  }

  public get violations(): readonly BlankLineViolation[] {
    return this.found;
  }

  public check(): this {
    this.visit(this.source);

    return this;
  }

  public fixed(): string {
    let out = this.text;

    for (const at of [...new Set(this.inserts)].sort((a, b) => b - a)) out = `${out.slice(0, at)}\n${out.slice(at)}`;

    return out;
  }

  private visit(node: Node): void {
    if (node.kind === SyntaxKind.SourceFile) this.statements((node as SourceFile).statements);

    if (isBlock(node) || isModuleBlock(node) || isCaseClause(node) || isDefaultClause(node))
      this.statements(node.statements);

    if (isClassDeclaration(node) || isClassExpression(node)) this.members(node.members);

    node.forEachChild((child) => {
      this.visit(child);
    });
  }

  private statements(list: readonly Statement[]): void {
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1];
      const after = list[i];

      if (before === undefined || after === undefined) continue;

      const reason = this.statementReason(before, after);

      if (reason !== undefined) this.require(before, after, reason);
    }
  }

  private statementReason(before: Statement, after: Statement): string | undefined {
    if (BlankLines.MODULE_KINDS.has(before.kind) && BlankLines.MODULE_KINDS.has(after.kind)) return undefined;

    if (this.multiline(before)) return "after a statement that spans several lines";

    if (this.multiline(after)) return "before a statement that spans several lines";

    if (BlankLines.EXIT_KINDS.has(after.kind)) return "before return or throw";

    if (this.group(before) !== this.group(after)) return "between different kinds of statements";

    return undefined;
  }

  private group(node: Statement): string {
    if (BlankLines.MODULE_KINDS.has(node.kind)) return "module";

    if (node.kind === SyntaxKind.VariableStatement) return "variable";

    if (BlankLines.CONTROL_KINDS.has(node.kind)) return "control";

    return "other";
  }

  private members(list: readonly Node[]): void {
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1];
      const after = list[i];

      if (before === undefined || after === undefined) continue;

      const fields =
        isPropertyDeclaration(before) &&
        isPropertyDeclaration(after) &&
        !this.multiline(before) &&
        !this.multiline(after);

      if (!fields) this.require(before, after, "between class members");
    }
  }

  private require(before: Node, after: Node, reason: string): void {
    const start = this.leadingStart(after);
    const gap = this.text.slice(before.end, start);

    if (/\n[ \t]*\n/.test(gap)) return;

    if (!gap.includes("\n")) return;

    const lineStart = this.text.lastIndexOf("\n", start - 1) + 1;

    this.inserts.push(lineStart);
    this.found.push({ file: this.file, line: this.lineOf(start), reason });
  }

  private leadingStart(node: Node): number {
    let i = node.pos;

    while (i < this.text.length && /\s/.test(this.text[i] ?? "")) i++;

    if (i >= node.end) throw new Error(`${this.file}: node offsets do not match the file text at ${node.pos}`);

    return i;
  }

  private tokenStart(node: Node): number {
    let i = this.leadingStart(node);

    while (this.text.startsWith("/*", i) || this.text.startsWith("//", i)) {
      const close = this.text.startsWith("/*", i) ? this.text.indexOf("*/", i) + 2 : this.text.indexOf("\n", i);

      if (close <= i) throw new Error(`${this.file}: unterminated comment at ${i}`);

      i = close;

      while (i < this.text.length && /\s/.test(this.text[i] ?? "")) i++;
    }

    return i;
  }

  private multiline(node: Node): boolean {
    return this.text.slice(this.tokenStart(node), node.end).includes("\n");
  }

  private lineOf(offset: number): number {
    let line = 1;

    for (let i = 0; i < offset; i++) if (this.text[i] === "\n") line++;

    return line;
  }
}
