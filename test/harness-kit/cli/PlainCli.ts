import { CLI, CliBase } from "../../../src/harness-kit/index.ts";
import { PlainWorkflow } from "./PlainWorkflow.ts";

@CLI({ name: "plain", version: "1.0.0", commands: [PlainWorkflow] })
export class PlainCli extends CliBase {}
