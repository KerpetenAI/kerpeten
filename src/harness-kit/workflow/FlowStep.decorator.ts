import { defineComponent } from "@asenajs/ioc";
import { ClassMetadata } from "../ClassMetadata.ts";
import { KitKinds } from "../container/KitKinds.ts";
import type { FlowStepBase } from "./FlowStepBase.ts";
import type { FlowStepSpec } from "./types/workflow.ts";

const SPECS = new ClassMetadata<FlowStepSpec>("FlowStep");

/** Marks a flow step of a workflow and registers it as a container component named `flow-step:<name>`. */
export function FlowStep(spec: FlowStepSpec) {
  return (target: abstract new () => FlowStepBase): void => {
    SPECS.set(target, spec);
    defineComponent(KitKinds.FLOW_STEP, `flow-step:${spec.name}`)(target);
  };
}

export function flowStepSpec(target: object): FlowStepSpec {
  return SPECS.get(target);
}
