import { CLI, CliBase } from "../../../src/harness-kit/index.ts";
import { EchoCommand } from "./EchoCommand.ts";
import { EchoTwinCommand } from "./EchoTwinCommand.ts";

@CLI({ name: "twin", version: "1.0.0", commands: [EchoCommand, EchoTwinCommand] })
export class TwinCli extends CliBase {}
