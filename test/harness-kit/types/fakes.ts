export interface Recorded {
  readonly name: string;
  readonly input: unknown;
}

export interface Captured {
  readonly path: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

export interface Stamp {
  readonly before: number;
  readonly after: number;
  readonly searched: boolean;
}
