import { defineComponent } from "@asenajs/ioc";
import { ClassMetadata } from "../ClassMetadata.ts";
import { KitKinds } from "../container/KitKinds.ts";
import type { Chain, PartClass, WorkflowSpec } from "./types/workflow.ts";
import type { WorkflowBase } from "./WorkflowBase.ts";

const SPECS = new ClassMetadata<WorkflowSpec>("Workflow");

/**
 * Marks a workflow class, registers it as a container component named `workflow:<name>` and checks its flow steps at
 * compile time: each flow step must find the fields it takes, no flow step may add a field that is already there, the flow steps
 * must reach the workflow's final state and an early end must carry the workflow's result. With a `command` the
 * workflow is a command a CLI can list; a flag of its `oneOf` group that has the name of one of its options throws.
 */
export function Workflow<const Parts extends readonly PartClass[]>(spec: WorkflowSpec<Parts>) {
  const { command } = spec;

  for (const flag of command?.oneOf?.flags ?? []) {
    if (command !== undefined && Object.hasOwn(command.options, flag)) {
      throw new Error(`the ${command.name} flag --${flag} has the name of an option of the command`);
    }
  }

  return <Input extends object, State extends Input, Result>(
    target: (abstract new () => WorkflowBase<Input, State, Result>) & Chain<Parts, Input, State, Result>,
  ): void => {
    SPECS.set(target, spec);
    defineComponent(KitKinds.WORKFLOW, `workflow:${spec.name}`)(target);
  };
}

export function workflowSpec(target: object): WorkflowSpec {
  return SPECS.get(target);
}
