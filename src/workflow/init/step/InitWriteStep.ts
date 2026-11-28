import { Inject } from "@asenajs/ioc";
import { ConfigFileWriter } from "../../../capability/config/ConfigFileWriter.ts";
import { ConfigLoader } from "../../../capability/config/ConfigLoader.ts";
import type { KerpetenConfig, ModelConfig } from "../../../capability/config/types/config.ts";
import { type After, FlowStep, FlowStepBase, type KitInstances, KitNames, Use } from "../../../harness-kit/index.ts";
import type { InitAnswers, InitModel } from "../types/init.ts";
import type { InitQuestionStep } from "./InitQuestionStep.ts";

/**
 * Builds `.kerpeten.yml` from the answers and loads the text through the loader and schema of the review before it
 * creates the file. Text that does not load, or does not hold the answers, is a bug of init and an error, not a file.
 */
@FlowStep({
  name: "init-write",
  description:
    "Builds .kerpeten.yml from the answers, loads it through the configuration loader and creates it in the repository root without overwriting anything.",
})
export class InitWriteStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(ConfigLoader)
  private readonly loader!: ConfigLoader;

  @Use(ConfigFileWriter)
  private readonly writer!: ConfigFileWriter;

  public execute(state: After<typeof InitQuestionStep>) {
    const text = InitWriteStep.text(state.answers);
    const config = this.loaded(text, state.answers);
    const path = this.writer.create(state.repo, text);

    this.io.out(`Wrote ${path}.`);

    return { config };
  }

  private static text(answers: InitAnswers): string {
    const data = {
      models: { reviewer: InitWriteStep.model(answers.reviewer), judge: InitWriteStep.model(answers.judge) },
      comment_language: answers.language,
    };

    return `${Bun.YAML.stringify(data, null, 2)}\n`;
  }

  private static model(model: InitModel): InitModel {
    return { provider: model.provider, model: model.model };
  }

  private static same(loaded: ModelConfig, answer: InitModel): boolean {
    return loaded.provider === answer.provider && loaded.model === answer.model;
  }

  private loaded(text: string, answers: InitAnswers): KerpetenConfig {
    const result = this.loader.parse(text);

    if (!result.ok) {
      throw new Error(
        `the ${ConfigLoader.CONFIG_FILE} that init built does not load, which is a bug of kerpeten init; no file was written: ${result.errors.join("; ")}`,
      );
    }

    const { config } = result;

    if (
      !InitWriteStep.same(config.models.reviewer, answers.reviewer) ||
      !InitWriteStep.same(config.models.judge, answers.judge) ||
      config.comment_language !== answers.language
    ) {
      throw new Error(
        `the ${ConfigLoader.CONFIG_FILE} that init built does not hold the answers, which is a bug of kerpeten init; no file was written`,
      );
    }

    return config;
  }
}
