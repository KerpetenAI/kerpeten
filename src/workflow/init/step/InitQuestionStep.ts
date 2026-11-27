import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { ChatGptAuthFile } from "../../../capability/chatgpt/ChatGptAuthFile.ts";
import { ChatGptPlan } from "../../../capability/chatgpt/ChatGptPlan.ts";
import {
  type After,
  ExitCode,
  FlowStep,
  FlowStepBase,
  type KitInstances,
  KitNames,
} from "../../../harness-kit/index.ts";
import { terminalLine } from "../../../text/text-utils.ts";
import { AnswerReader } from "../AnswerReader.ts";
import { InitInputError } from "../InitInputError.ts";
import { InitQuestions } from "../InitQuestions.ts";
import type { PlanModelList } from "../types/init.ts";
import type { InitTargetStep } from "./InitTargetStep.ts";

/** Asks the questions of init on standard output and reads one answer per line of standard input. */
@FlowStep({
  name: "init-questions",
  description:
    "Asks for the provider and model of the reviewer and of the judge and for the language of the review comments, one line of standard input per answer.",
})
export class InitQuestionStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(Names.STDIN)
  private readonly stdin!: Instances[Names.STDIN];

  @Inject(ChatGptAuthFile)
  private readonly file!: ChatGptAuthFile;

  @Inject(ChatGptPlan)
  private readonly plan!: ChatGptPlan;

  public async execute(_state: After<typeof InitTargetStep>) {
    const questions = new InitQuestions({
      io: this.io,
      answers: new AnswerReader(this.stdin),
      planModels: () => this.planModels(),
    });

    try {
      return { answers: await questions.ask() };
    } catch (error) {
      if (!(error instanceof InitInputError)) throw error;

      return this.end(this.command.fail(ExitCode.USAGE, error.message));
    }
  }

  private async planModels(): Promise<PlanModelList> {
    try {
      if (this.file.read()?.tokens === undefined) {
        return { ok: false, reason: "Not signed in to ChatGPT, so the models of your plan cannot be listed" };
      }

      const models = await this.plan.adapter.listModels();

      if (models.length === 0) return { ok: false, reason: "Your ChatGPT plan lists no models" };

      return { ok: true, models };
    } catch (error) {
      return {
        ok: false,
        reason: `The models of your ChatGPT plan cannot be listed (${terminalLine(ChatGptPlan.failureMessage(error))})`,
      };
    }
  }
}
