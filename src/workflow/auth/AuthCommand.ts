import { type After, type CommandArgs, UsageError, Workflow, WorkflowBase } from "../../harness-kit/index.ts";
import { AuthStep } from "./step/AuthStep.ts";
import type { AuthAction, AuthInput } from "./types/auth.ts";

/** The `auth` command: the ChatGPT sign-in on this machine, by the action word the command line starts with. */
@Workflow({
  name: "auth",
  description:
    "Sign in with ChatGPT so that models with provider chatgpt use your ChatGPT plan. login opens the sign-in in your browser, status shows the sign-in (--models also lists the models of your plan), logout signs out on this machine.",
  steps: [AuthStep],
  command: {
    name: "auth",
    usage: "login | logout | status [--models]",
    options: { models: { type: "boolean" } },
    actions: ["login", "logout", "status"],
  },
})
export class AuthCommand extends WorkflowBase<AuthInput, After<typeof AuthStep>, number> {
  public override commandInput(args: CommandArgs): AuthInput {
    const action = args.action as AuthAction;
    const models = args.boolean("models");

    if (models && action !== "status") throw new UsageError("--models goes with status only");

    return { action, models };
  }

  protected finish(state: After<typeof AuthStep>): number {
    return state.code;
  }
}
