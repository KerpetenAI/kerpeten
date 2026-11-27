import type { SourceFile } from "typescript/unstable/ast";

export interface ProjectFile {
  readonly file: string;
  readonly path: string;
  readonly source: SourceFile;
}

export type FileVisitor = (file: ProjectFile) => void;

export type PathFilter = (path: string) => boolean;

export interface BlankLineViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export interface BlankLineReport {
  readonly files: number;
  readonly violations: readonly BlankLineViolation[];
}

export type FileKind =
  | "class"
  | "types"
  | "utils"
  | "schema"
  | "decorator"
  | "entry"
  | "barrel"
  | "test"
  | "declaration"
  | "generated"
  | "unknown";

export type LayoutRule =
  | "kind/unknown"
  | "kind/class"
  | "name/class"
  | "kind/types"
  | "kind/utils"
  | "name/utils"
  | "kind/schema"
  | "kind/decorator"
  | "kind/entry"
  | "kind/barrel"
  | "kind/test"
  | "type-literal"
  | "name/case"
  | "nested-class"
  | "nested-type";

export interface LayoutViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: LayoutRule;
  readonly message: string;
}

export interface LayoutReport {
  readonly files: number;
  readonly violations: readonly LayoutViolation[];
}
