export interface CommentPosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceScan {
  readonly comments: number[];
  readonly strings: [number, number][];
}
