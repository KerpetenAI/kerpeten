export interface OrderInput {
  readonly customer: string;
  readonly items: readonly string[];
}

export interface Discount {
  readonly rate: number;
  readonly reason: string;
}

export interface OrderResult {
  readonly total: number;
  readonly note: string;
}

export interface ShopInput extends OrderInput {
  readonly shop: string;
}

export interface ShopResult {
  readonly receipt: string;
}

export interface ProbeDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly code: number;
  readonly text: string;
}
