import { CLI, CliBase } from "../../../src/harness-kit/index.ts";
import { EchoCommand } from "./EchoCommand.ts";

@CLI({ name: "other", version: "1.0.0", commands: [EchoCommand] })
export class OtherCli extends CliBase {}
