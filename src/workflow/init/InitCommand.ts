import { type After, ExitCode, Workflow, WorkflowBase } from "@kerpetensh/harness-kit";
import { errorMessage } from "../../text/text-utils.ts";
import { InitCheckStep } from "./step/InitCheckStep.ts";
import { InitQuestionStep } from "./step/InitQuestionStep.ts";
import { InitTargetStep } from "./step/InitTargetStep.ts";
import { InitWriteStep } from "./step/InitWriteStep.ts";

/**
 * The `init` command: asks for the models and the comment language, writes `.kerpeten.yml` to the root of the git
 * repository and checks the setup. It ends with 0 once the file is written, also when the check finds something
 * missing; an error that ends it before is reported and ends it with 1.
 */
@Workflow({
  name: "init",
  description:
    "Ask for the provider and model of the reviewer and of the judge and the language of the review comments, write .kerpeten.yml to the root of this git repository and check the setup. An existing .kerpeten.yml is never changed.",
  steps: [InitTargetStep, InitQuestionStep, InitWriteStep, InitCheckStep],
  command: { name: "init", usage: "", options: {} },
})
export class InitCommand extends WorkflowBase<object, After<typeof InitCheckStep>, number> {
  public override commandInput(): object {
    return {};
  }

  protected override rescue(error: unknown): number {
    return this.command.fail(ExitCode.FAILED, errorMessage(error));
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}
