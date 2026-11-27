import pkg from "../../package.json" with { type: "json" };
import { CLI, CliBase } from "../harness-kit/index.ts";
import { AuthCommand } from "../workflow/auth/AuthCommand.ts";
import { CapabilitiesCommand } from "../workflow/capabilities/CapabilitiesCommand.ts";
import { ReviewCommand } from "../workflow/review-command/ReviewCommand.ts";
import { SelfCheckCommand } from "../workflow/self-check/SelfCheckCommand.ts";

@CLI({
  name: "kerpeten",
  version: pkg.version,
  commands: [ReviewCommand, AuthCommand, SelfCheckCommand, CapabilitiesCommand],
})
export class Cli extends CliBase {}
