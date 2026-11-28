import { type After, ExitCode, FlowStep, FlowStepBase, Use } from "@kerpetensh/harness-kit";
import { AnswerInputError } from "../../../capability/stdin/AnswerInputError.ts";
import { InitQuestions } from "../InitQuestions.ts";
import type { InitTargetStep } from "./InitTargetStep.ts";

/** Asks the questions of init on standard output and reads one answer per line of standard input. */
@FlowStep({
  name: "init-questions",
  description:
    "Asks for the provider and model of the reviewer and of the judge and for the language of the review comments, one line of standard input per answer.",
})
export class InitQuestionStep extends FlowStepBase {
  @Use(InitQuestions)
  private readonly questions!: InitQuestions;

  public async execute(_state: After<typeof InitTargetStep>) {
    try {
      return { answers: await this.questions.ask() };
    } catch (error) {
      if (!(error instanceof AnswerInputError)) throw error;

      return this.end(this.command.fail(ExitCode.USAGE, `${error.message}; no file was written`));
    }
  }
}
