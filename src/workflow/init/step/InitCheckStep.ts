import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase, type KitInstances, KitNames } from "@kerpetensh/harness-kit";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { ChatGptAuthFile } from "../../../capability/chatgpt/ChatGptAuthFile.ts";
import { ChatGptOAuth } from "../../../capability/chatgpt/ChatGptOAuth.ts";
import { ChatGptPlan } from "../../../capability/chatgpt/ChatGptPlan.ts";
import { ConfigLoader } from "../../../capability/config/ConfigLoader.ts";
import type { KerpetenConfig } from "../../../capability/config/types/config.ts";
import { RipgrepSearch } from "../../../capability/repo/RipgrepSearch.ts";
import type { PromptRole } from "../../../harnesses/types/harnesses.ts";
import { terminalLine } from "../../../text/text-utils.ts";
import { ModelKeys } from "../../review-command/ModelKeys.ts";
import type { InitWriteStep } from "./InitWriteStep.ts";

/**
 * Checks what a review needs beside the file, one line per item with how to fix what is missing, and shows the next
 * command. It prints the name of a key variable, never its value, and calls no server.
 */
@FlowStep({
  name: "init-check",
  description:
    "Checks that ripgrep is on PATH, that the key variable of each model with an API key is set and that a ChatGPT sign-in exists for a chatgpt model, then shows the next command.",
})
export class InitCheckStep extends FlowStepBase {
  private static readonly CHATGPT = "chatgpt";

  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @Inject(ChatGptAuthFile)
  private readonly file!: ChatGptAuthFile;

  public execute(state: After<typeof InitWriteStep>) {
    const { io } = this;

    io.out("");
    io.out("Setup check:");

    for (const line of this.lines(state.config)) io.out(`  ${line}`);

    io.out("");
    io.out("Next: kerpeten review --dry-run");
    io.out(`Commit ${ConfigLoader.CONFIG_FILE} so that everyone on the project reviews with the same settings.`);

    return {};
  }

  private static roleText(roles: readonly PromptRole[]): string {
    return roles.join(" and ");
  }

  private lines(config: KerpetenConfig): readonly string[] {
    const needs = new Map<string, PromptRole[]>();

    for (const role of ["reviewer", "judge"] as const) {
      const model = config.models[role];
      const need = model.provider === "chatgpt" ? InitCheckStep.CHATGPT : ModelKeys.keyEnvName(model);

      needs.set(need, [...(needs.get(need) ?? []), role]);
    }

    return [
      this.ripgrepLine(),
      ...[...needs].map(([need, roles]) =>
        need === InitCheckStep.CHATGPT ? this.signInLine(roles) : this.keyLine(need, roles),
      ),
    ];
  }

  private ripgrepLine(): string {
    if (RipgrepSearch.onPath(this.env.PATH ?? RipgrepSearch.FALLBACK_PATH)) return "ok: ripgrep (rg) is on PATH";

    return "missing: ripgrep (rg) is not on PATH; install it: https://github.com/BurntSushi/ripgrep";
  }

  private keyLine(name: string, roles: readonly PromptRole[]): string {
    const value = this.env[name];
    const who = InitCheckStep.roleText(roles);

    if (value !== undefined && value.trim() !== "") return `ok: ${name} is set (${who})`;

    return `missing: ${name} is not set (${who}); set it to your API key before you run a review`;
  }

  private signInLine(roles: readonly PromptRole[]): string {
    const who = InitCheckStep.roleText(roles);

    try {
      const tokens = this.file.read()?.tokens;

      if (tokens === undefined) return `missing: not signed in to ChatGPT (${who}); run \`kerpeten auth login\``;

      if (!tokens.scopes.includes(ChatGptOAuth.PLAN_SCOPE)) {
        return `missing: the ChatGPT sign-in does not allow plan usage (${who}); run \`kerpeten auth login\``;
      }

      return `ok: signed in to ChatGPT (${who})`;
    } catch (error) {
      return `missing: the ChatGPT sign-in cannot be used (${who}): ${terminalLine(ChatGptPlan.failureMessage(error))}`;
    }
  }
}
