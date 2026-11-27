export interface FlowInput {
  readonly label: string;
}

export interface FlowResult {
  readonly indexed: boolean;
}

export interface OuterFlowResult {
  readonly outer: boolean;
  readonly indexed: boolean;
}

export interface GrantedInput {
  readonly permissions: readonly string[];
}

export interface GroupedInput extends GrantedInput {
  readonly group?: string;
}

export interface CallInput {
  readonly inner: string;
  readonly label?: string;
}

export interface StrictInput {
  readonly group: string;
  readonly crash?: boolean;
}
