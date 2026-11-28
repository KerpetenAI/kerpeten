import { CLI, CliBase } from "@kerpetensh/harness-kit";
import pkg from "../../package.json" with { type: "json" };
import { AuthCommand } from "../workflow/auth/AuthCommand.ts";
import { CapabilitiesCommand } from "../workflow/capabilities/CapabilitiesCommand.ts";
import { InitCommand } from "../workflow/init/InitCommand.ts";
import { ReviewCommand } from "../workflow/review-command/ReviewCommand.ts";
import { SelfCheckCommand } from "../workflow/self-check/SelfCheckCommand.ts";

@CLI({
  name: "kerpeten",
  version: pkg.version,
  commands: [InitCommand, ReviewCommand, AuthCommand, SelfCheckCommand, CapabilitiesCommand],
})
export class Cli extends CliBase {}
