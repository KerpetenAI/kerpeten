import { type Node, NodeFlags, type SourceFile, type Statement, SyntaxKind } from "typescript/unstable/ast";
import {
  isArrowFunction,
  isClassDeclaration,
  isClassExpression,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isImportDeclaration,
  isInterfaceDeclaration,
  isMetaProperty,
  isModuleDeclaration,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isVariableStatement,
} from "typescript/unstable/ast/is";
import type { FileKind, LayoutRule, LayoutViolation } from "./types/check.ts";

export class LayoutRules {
  public static readonly RULES: readonly LayoutRule[] = [
    "kind/unknown",
    "kind/class",
    "name/class",
    "kind/types",
    "kind/utils",
    "name/utils",
    "kind/schema",
    "kind/decorator",
    "kind/entry",
    "kind/barrel",
    "kind/test",
    "type-literal",
    "name/case",
    "nested-class",
    "nested-type",
  ];

  private static readonly ROOTS: ReadonlySet<string> = new Set(["src", "scripts", "test"]);

  private static readonly TYPED_ROOTS: ReadonlySet<string> = new Set(["src", "scripts"]);

  private static readonly ENTRY = "src/cli/main.ts";

  private static readonly PASCAL = /^[A-Z][A-Za-z0-9]*$/;

  private static readonly KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  private static readonly SUFFIXES: readonly string[] = [".decorator.ts", ".generated.ts", ".test.ts", ".d.ts", ".ts"];

  private readonly path: string;
  private readonly source: SourceFile;
  private readonly kind: FileKind;
  private readonly found: LayoutViolation[] = [];

  public constructor(path: string, source: SourceFile) {
    this.path = path;
    this.source = source;
    this.kind = LayoutRules.kindOf(path);
  }

  public static kindOf(path: string): FileKind {
    const parts = path.split("/");
    const name = parts.at(-1) ?? "";
    const folder = parts.at(-2);
    const top = parts[0] ?? "";

    if (name.endsWith(".generated.ts")) return folder === "types" ? "generated" : "unknown";

    if (name.endsWith(".d.ts")) return folder === "types" ? "declaration" : "unknown";

    if (parts.length < 2 || !LayoutRules.ROOTS.has(top)) return "unknown";

    if (name.endsWith(".test.ts")) return top === "test" ? "test" : "unknown";

    if (folder === "types") return "types";

    if (folder === "schemas") return "schema";

    if (name === "index.ts") return "barrel";

    if (name.endsWith(".decorator.ts")) return "decorator";

    if (path === LayoutRules.ENTRY || (top === "scripts" && parts.length === 2)) return "entry";

    if (name.endsWith("-utils.ts")) return "utils";

    return "class";
  }

  public get violations(): readonly LayoutViolation[] {
    return this.found;
  }

  public check(): this {
    if (this.kind === "generated") return this;

    if (this.kind === "unknown") {
      this.report(undefined, "kind/unknown", "the path fits no file kind");

      return this;
    }

    this.checkKind();
    this.checkName();
    this.visit(this.source, false);

    return this;
  }

  private checkKind(): void {
    switch (this.kind) {
      case "class":
        this.classFile();
        break;

      case "types":
        this.typesFile();
        break;

      case "declaration":
        this.declarationFile();
        break;

      case "utils":
        this.utilsFile();
        break;

      case "schema":
        this.schemaFile();
        break;

      case "decorator":
        this.decoratorFile();
        break;

      case "entry":
        this.entryFile();
        break;

      case "barrel":
        this.barrelFile();
        break;

      case "test":
        this.testFile();
        break;

      default:
        break;
    }
  }

  private checkName(): void {
    const root = this.root();

    if (this.kind === "class") {
      const names = this.source.statements
        .filter((node) => isClassDeclaration(node) || isEnumDeclaration(node))
        .map((node) => node.name?.text);

      if (!LayoutRules.PASCAL.test(root))
        this.report(undefined, "name/class", `a class file is named after its class in PascalCase, not ${root}.ts`);
      else if (names.length > 0 && !names.includes(root))
        this.report(undefined, "name/class", `the file name ${root}.ts differs from the class name ${names[0]}`);

      return;
    }

    if (this.kind === "decorator") return;

    if (this.kind === "utils") {
      const folder = this.path.split("/").at(-2);

      if (root !== `${folder}-utils`)
        this.report(undefined, "name/utils", `a utils file in ${folder}/ is named ${folder}-utils.ts, not ${root}.ts`);

      return;
    }

    if (!LayoutRules.KEBAB.test(root)) this.report(undefined, "name/case", `the file name ${root} is not kebab-case`);
    else if (this.kind === "schema" && !root.endsWith("-schema"))
      this.report(undefined, "name/case", `a schema file name ends in -schema, not ${root}`);
  }

  private classFile(): void {
    let classes = 0;

    for (const node of this.source.statements) {
      if (isImportDeclaration(node)) continue;

      if (!isClassDeclaration(node) && !isEnumDeclaration(node)) {
        this.report(
          node,
          "kind/class",
          `a class file holds imports and one exported class or enum, not ${this.describe(node)}`,
        );

        continue;
      }

      classes++;

      if (this.has(node, SyntaxKind.DefaultKeyword))
        this.report(node, "kind/class", "the class is exported by name, not with export default");
      else if (!this.has(node, SyntaxKind.ExportKeyword))
        this.report(
          node,
          "kind/class",
          `the ${isEnumDeclaration(node) ? "enum" : "class"} ${node.name?.text} is not exported`,
        );

      if (classes > 1) this.report(node, "kind/class", `a class file holds one class, not also ${node.name?.text}`);
    }

    if (classes === 0)
      this.report(undefined, "kind/class", "a class file holds one exported class or enum and has none");
  }

  private typesFile(): void {
    for (const node of this.source.statements) {
      if (isEnumDeclaration(node) || isInterfaceDeclaration(node) || isTypeAliasDeclaration(node)) continue;

      if (isImportDeclaration(node) && node.importClause?.phaseModifier === SyntaxKind.TypeKeyword) continue;

      if (isExportDeclaration(node) && node.isTypeOnly && node.moduleSpecifier !== undefined) continue;

      this.report(
        node,
        "kind/types",
        `a types file holds import type, interface, type and export type from, not ${this.describe(node)}`,
      );
    }
  }

  private declarationFile(): void {
    for (const node of this.source.statements) {
      if (isModuleDeclaration(node) || isEnumDeclaration(node)) continue;

      this.report(node, "kind/types", `a declaration file holds declare module only, not ${this.describe(node)}`);
    }
  }

  private utilsFile(): void {
    const exportedConstants = this.path.startsWith("test/");

    for (const node of this.source.statements) {
      if (isImportDeclaration(node) || isEnumDeclaration(node)) continue;

      if (isFunctionDeclaration(node) && !this.has(node, SyntaxKind.DefaultKeyword)) continue;

      if (isVariableStatement(node) && this.plainConstant(node)) {
        if (exportedConstants || !this.has(node, SyntaxKind.ExportKeyword)) continue;

        this.report(node, "kind/utils", "a utils file does not export constants");
        continue;
      }

      this.report(
        node,
        "kind/utils",
        `a utils file holds imports, function declarations and constants that are not functions, not ${this.describe(node)}`,
      );
    }
  }

  private schemaFile(): void {
    for (const node of this.source.statements) {
      if (isImportDeclaration(node) || isEnumDeclaration(node)) continue;

      if (isVariableStatement(node) && this.plainConstant(node)) continue;

      this.report(
        node,
        "kind/schema",
        `a schema file holds imports and constants that are not functions, not ${this.describe(node)}`,
      );
    }
  }

  private decoratorFile(): void {
    const root = this.root();
    const functions = new Set<string>();
    let decorator = false;
    let constants = 0;

    for (const node of this.source.statements) {
      if (isImportDeclaration(node) || isEnumDeclaration(node)) continue;

      if (isFunctionDeclaration(node) && !this.has(node, SyntaxKind.DefaultKeyword)) {
        const name = node.name?.text ?? "";

        if (name === root && this.has(node, SyntaxKind.ExportKeyword)) decorator = true;

        if (!functions.has(name) && functions.size === 2)
          this.report(node, "kind/decorator", `a decorator file holds the decorator and one reader, not also ${name}`);

        functions.add(name);
        continue;
      }

      if (
        isVariableStatement(node) &&
        this.plainConstant(node) &&
        !this.has(node, SyntaxKind.ExportKeyword) &&
        constants === 0
      ) {
        constants++;
        continue;
      }

      this.report(
        node,
        "kind/decorator",
        `a decorator file holds imports, its functions and one private constant, not ${this.describe(node)}`,
      );
    }

    if (!LayoutRules.PASCAL.test(root) || !decorator)
      this.report(
        undefined,
        "kind/decorator",
        `a decorator file <Name>.decorator.ts exports the PascalCase function Name; ${root}.decorator.ts does not`,
      );
  }

  private entryFile(): void {
    let mains = 0;

    for (const node of this.source.statements) {
      if (isImportDeclaration(node)) continue;

      if (isIfStatement(node) && node.elseStatement === undefined && this.importMetaMain(node.expression)) {
        mains++;

        if (mains > 1) this.report(node, "kind/entry", "an entry file holds one if (import.meta.main)");

        continue;
      }

      this.report(
        node,
        "kind/entry",
        `an entry file holds imports and one if (import.meta.main), not ${this.describe(node)}`,
      );
    }

    if (mains === 0) this.report(undefined, "kind/entry", "an entry file holds one if (import.meta.main) and has none");
  }

  private barrelFile(): void {
    for (const node of this.source.statements) {
      if (isExportDeclaration(node) && node.moduleSpecifier !== undefined) continue;

      this.report(node, "kind/barrel", `an index file holds export … from only, not ${this.describe(node)}`);
    }
  }

  private visit(node: Node, topLevel: boolean): void {
    this.nested(node, topLevel);

    if (
      isTypeLiteralNode(node) &&
      LayoutRules.TYPED_ROOTS.has(this.path.split("/")[0] ?? "") &&
      this.kind !== "types" &&
      this.kind !== "declaration"
    )
      this.report(node, "type-literal", "an object type literal outside types/; name it in a types/ file");

    node.forEachChild((child) => {
      this.visit(child, node === this.source);
    });
  }

  private nested(node: Node, topLevel: boolean): void {
    if (isClassExpression(node))
      this.report(node, "nested-class", "a class expression; declare the class in its own class file");
    else if (isClassDeclaration(node) && !topLevel)
      this.report(
        node,
        "nested-class",
        `the class ${node.name?.text ?? "(anonymous)"} is declared inside another declaration; move it to its own class file`,
      );
    else if (
      (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node)) &&
      !topLevel &&
      this.kind !== "types" &&
      this.kind !== "declaration"
    )
      this.report(
        node,
        "nested-type",
        `${node.name.text} is declared inside another declaration; move it to a types/ file`,
      );
  }

  private testFile(): void {
    for (const node of this.source.statements) this.testStatement(node);
  }

  private testStatement(node: Statement): void {
    if (isClassDeclaration(node))
      this.report(node, "kind/test", "a test file declares no class; move it to its own class file");
    else if (isInterfaceDeclaration(node) || isTypeAliasDeclaration(node))
      this.report(node, "kind/test", `a test file declares no type; move ${node.name.text} to a types/ file`);
  }

  private plainConstant(node: Statement): boolean {
    if (!isVariableStatement(node)) return false;

    const list = node.declarationList;

    if ((list.flags & NodeFlags.BlockScoped) !== NodeFlags.Const) return false;

    return list.declarations.every((declaration) => {
      let value = declaration.initializer;

      while (value !== undefined && isParenthesizedExpression(value)) value = value.expression;

      return value === undefined || !(isArrowFunction(value) || isFunctionExpression(value));
    });
  }

  private importMetaMain(node: Node): boolean {
    return (
      isPropertyAccessExpression(node) &&
      isIdentifier(node.name) &&
      node.name.text === "main" &&
      isMetaProperty(node.expression) &&
      node.expression.keywordToken === SyntaxKind.ImportKeyword &&
      node.expression.name.text === "meta"
    );
  }

  private has(node: Statement, modifier: SyntaxKind): boolean {
    const modifiers =
      isClassDeclaration(node) ||
      isFunctionDeclaration(node) ||
      isVariableStatement(node) ||
      isInterfaceDeclaration(node) ||
      isTypeAliasDeclaration(node) ||
      isEnumDeclaration(node) ||
      isModuleDeclaration(node)
        ? node.modifiers
        : undefined;

    return (modifiers ?? []).some((item) => item.kind === modifier);
  }

  private describe(node: Statement): string {
    if (this.has(node, SyntaxKind.DefaultKeyword)) return "export default";

    if (isClassDeclaration(node)) return `class ${node.name?.text ?? "(anonymous)"}`;

    if (isFunctionDeclaration(node)) return `function ${node.name?.text ?? "(anonymous)"}`;

    if (isInterfaceDeclaration(node)) return `interface ${node.name.text}`;

    if (isTypeAliasDeclaration(node)) return `type ${node.name.text}`;

    if (isVariableStatement(node)) {
      const names = node.declarationList.declarations.map((declaration) =>
        isIdentifier(declaration.name) ? declaration.name.text : "{…}",
      );

      if ((node.declarationList.flags & NodeFlags.BlockScoped) !== NodeFlags.Const)
        return `the variable ${names.join(", ")}`;

      return `${this.plainConstant(node) ? "const" : "the function constant"} ${names.join(", ")}`;
    }

    if (isImportDeclaration(node)) return "a value import";

    if (isExportDeclaration(node)) return node.moduleSpecifier === undefined ? "export { … }" : "export … from";

    if (isExportAssignment(node)) return "export default";

    if (isModuleDeclaration(node)) return "a module declaration";

    if (isIfStatement(node)) return "an if statement";

    if (isExpressionStatement(node)) return "a bare expression";

    return `a ${SyntaxKind[node.kind]}`;
  }

  private root(): string {
    const name = this.path.split("/").at(-1) ?? "";
    const suffix = LayoutRules.SUFFIXES.find((end) => name.endsWith(end)) ?? "";

    return name.slice(0, name.length - suffix.length);
  }

  private report(node: Node | undefined, rule: LayoutRule, message: string): void {
    const line =
      node === undefined ? 1 : this.source.getLineAndCharacterOfPosition(node.getStart(this.source)).line + 1;

    this.found.push({ file: this.path, line, rule, message });
  }
}
