import type { CommandSpec } from "../../cli/types/cli.ts";
import type { WorkflowEnd } from "../WorkflowEnd.ts";

export interface FlowStepSpec {
  readonly name: string;
  /** One plain sentence saying what the flow step does. */
  readonly description: string;
}

export interface WorkflowSpec<Parts extends readonly PartClass[] = readonly PartClass[]> {
  readonly name: string;
  /** One plain sentence saying what the workflow does. */
  readonly description: string;
  /** The flow steps in run order. A workflow class may be listed too; its result joins the state. */
  readonly steps: Parts;
  /** Makes the workflow a command a CLI can list; a workflow without it is internal. */
  readonly command?: CommandSpec;
}

/** What a workflow runs: a `FlowStepBase` or a `WorkflowBase`, seen from outside. */
export interface WorkflowPart {
  readonly name: string;
  execute(state: never): unknown;
}

export type PartClass = new () => WorkflowPart;

export interface RunningPart {
  readonly name: string;
  execute(state: object): unknown;
}

export type PartInstance<Part> = Part extends new () => infer Instance ? Instance : never;

export type PartOutput<Part> =
  PartInstance<Part> extends { execute(state: never): infer Output } ? Awaited<Output> : never;

/** The state a flow step or a workflow takes: the parameter type of its `execute`. */
export type NeedsOf<Part> = PartInstance<Part> extends { execute(state: infer State): unknown } ? State : never;

/** The fields a flow step adds: the return type of its `execute`, without an early end. A workflow adds its result. */
export type AddsOf<Part> = Exclude<PartOutput<Part>, WorkflowEnd<unknown>>;

export type EndOf<Part> = Extract<PartOutput<Part>, WorkflowEnd<unknown>>;

/**
 * The state after a flow step ran: what it took plus what it added. A flow step in its own file names its place in the
 * chain with `execute(state: After<typeof PreviousStep>)`.
 */
export type After<Part> = NeedsOf<Part> & AddsOf<Part>;

export interface FlowStepNeedsMore<FlowStep, Missing> {
  readonly flowStepNeedsMore: readonly [FlowStep, Missing];
}

export interface FlowStepAddsTwice<FlowStep, Keys> {
  readonly flowStepAddsTwice: readonly [FlowStep, Keys];
}

export interface FlowStepEndsWithOtherResult<FlowStep> {
  readonly flowStepEndsWithOtherResult: FlowStep;
}

export interface NoStepAdds<Missing> {
  readonly noStepAdds: Missing;
}

export type EndCheck<Part, Result> = [EndOf<Part>] extends [WorkflowEnd<Result>]
  ? unknown
  : FlowStepEndsWithOtherResult<Part>;

/** `unknown` when the flow step fits after `State`, otherwise a marker type that names the flow step and the problem. */
export type Link<Part, State, Result> = [State] extends [NeedsOf<Part>]
  ? [keyof State & keyof AddsOf<Part>] extends [never]
    ? EndCheck<Part, Result>
    : FlowStepAddsTwice<Part, keyof State & keyof AddsOf<Part>>
  : FlowStepNeedsMore<Part, Exclude<keyof NeedsOf<Part>, keyof State>>;

/** `unknown` when the flow steps run in a valid order from `State` to `Final`, otherwise the first marker type. */
export type Chain<Parts extends readonly unknown[], State, Final, Result> = Parts extends readonly [
  infer Head,
  ...infer Rest,
]
  ? unknown extends Link<Head, State, Result>
    ? Chain<Rest, State & AddsOf<Head>, Final, Result>
    : Link<Head, State, Result>
  : [State] extends [Final]
    ? unknown
    : NoStepAdds<Exclude<keyof Final, keyof State>>;
