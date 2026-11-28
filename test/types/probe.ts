/** One type error of a source that `typeErrors` compiled: the source, the line, the compiler's code and its text. */
export interface ProbeDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly text: string;
}
