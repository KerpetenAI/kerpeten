import { CLI, CliBase } from "../../../src/harness-kit/index.ts";
import { EchoCommand } from "./EchoCommand.ts";
import { WaveCommand } from "./WaveCommand.ts";

@CLI({ name: "demo", version: "9.8.7", commands: [EchoCommand, WaveCommand] })
export class DemoCli extends CliBase {}
