import { configSchema } from "../../capability/config/schemas/config-schema.ts";
import type { Io } from "../../harness-kit/index.ts";
import type { PromptRole } from "../../harnesses/types/harnesses.ts";
import { terminalLine } from "../../text/text-utils.ts";
import type { AnswerReader } from "./AnswerReader.ts";
import type {
  InitAnswers,
  InitDialog,
  InitModel,
  InitProvider,
  Parsed,
  PlanModelList,
  ProviderChoice,
} from "./types/init.ts";

/**
 * The questions of `kerpeten init`, one answer per line: the provider and model of the reviewer, whether the judge
 * uses the same, the provider and model of the judge when it does not, and the language of the review comments. An
 * answer that is not valid is asked again with a short reason; a model id and a language tag are checked with the
 * rules of the configuration schema.
 */
export class InitQuestions {
  public static readonly PROVIDERS: readonly ProviderChoice[] = [
    { provider: "chatgpt", label: "ChatGPT plan (chatgpt)" },
    { provider: "anthropic", label: "Anthropic, with an API key" },
    { provider: "openai", label: "OpenAI, with an API key" },
    { provider: "openrouter", label: "OpenRouter, with an API key" },
  ];

  private static readonly MODEL_REASON =
    "A model id is one word, without spaces or control characters, of at most 200 characters.";

  private static readonly LANGUAGE_REASON = "A language tag looks like en, tr or pt-BR.";

  private readonly io: Io;
  private readonly answers: AnswerReader;
  private readonly planModels: () => Promise<PlanModelList>;
  private listed: Promise<PlanModelList> | undefined;

  public constructor(dialog: InitDialog) {
    this.io = dialog.io;
    this.answers = dialog.answers;
    this.planModels = dialog.planModels;
  }

  public async ask(): Promise<InitAnswers> {
    const reviewer = await this.model("reviewer");

    const same = await this.question(
      "Should the judge use the same provider and model as the reviewer? [y/n]",
      (answer) => InitQuestions.yesNo(answer),
    );

    const judge = same ? reviewer : await this.model("judge");

    const language = await this.question("Language of the review comments, as a tag such as en, tr or de:", (answer) =>
      InitQuestions.language(answer),
    );

    return { reviewer, judge, language };
  }

  private async model(role: PromptRole): Promise<InitModel> {
    const { io } = this;
    const choices = InitQuestions.PROVIDERS;

    io.out(`Provider of the ${role}:`);

    for (const [index, choice] of choices.entries()) io.out(`  ${index + 1}. ${choice.label}`);

    const { provider } = await this.question(InitQuestions.numberPrompt(choices.length), (answer) =>
      InitQuestions.pick(answer, choices),
    );

    if (provider === "chatgpt") return this.planModel(role);

    return this.typedModel(role, provider);
  }

  private async planModel(role: PromptRole): Promise<InitModel> {
    const { io } = this;

    this.listed ??= this.planModels();

    const listed = await this.listed;

    if (!listed.ok) {
      io.out(`${listed.reason}; \`kerpeten auth login\` makes the list available.`);

      return this.typedModel(role, "chatgpt");
    }

    io.out(`Model of the ${role}, from your ChatGPT plan:`);

    for (const [index, model] of listed.models.entries()) {
      io.out(`  ${index + 1}. ${terminalLine(model.slug)} (${terminalLine(model.displayName)})`);
    }

    return this.question(InitQuestions.numberPrompt(listed.models.length), (answer) => {
      const picked = InitQuestions.pick(answer, listed.models);

      return picked.ok ? InitQuestions.modelId("chatgpt", picked.value.slug) : picked;
    });
  }

  private async typedModel(role: PromptRole, provider: InitProvider): Promise<InitModel> {
    return this.question(`Model id of the ${role}:`, (answer) => InitQuestions.modelId(provider, answer));
  }

  private async question<T>(prompt: string, parse: (answer: string) => Parsed<T>): Promise<T> {
    const { io } = this;

    for (;;) {
      io.out(prompt);

      const line = await this.answers.next();
      const parsed = line.cut ? InitQuestions.refuse<T>("The answer is too long.") : parse(line.text.trim());

      if (parsed.ok) return parsed.value;

      io.out(parsed.reason);
    }
  }

  private static numberPrompt(count: number): string {
    return `Number [1-${count}]:`;
  }

  private static refuse<T>(reason: string): Parsed<T> {
    return { ok: false, reason };
  }

  private static pick<T>(answer: string, items: readonly T[]): Parsed<T> {
    const item = /^[0-9]{1,4}$/.test(answer) ? items[Number(answer) - 1] : undefined;

    if (item === undefined) return InitQuestions.refuse(`Type a number from 1 to ${items.length}.`);

    return { ok: true, value: item };
  }

  private static yesNo(answer: string): Parsed<boolean> {
    const word = answer.toLowerCase();

    if (word === "y" || word === "yes") return { ok: true, value: true };
    if (word === "n" || word === "no") return { ok: true, value: false };

    return InitQuestions.refuse("Type y or n.");
  }

  private static modelId(provider: InitProvider, answer: string): Parsed<InitModel> {
    if (answer === "") return InitQuestions.refuse("An answer is needed.");

    const model = { provider, model: answer };

    if (!configSchema.shape.models.shape.reviewer.safeParse(model).success) {
      return InitQuestions.refuse(InitQuestions.MODEL_REASON);
    }

    return { ok: true, value: model };
  }

  private static language(answer: string): Parsed<string> {
    if (answer === "") return InitQuestions.refuse("An answer is needed.");

    if (!configSchema.shape.comment_language.safeParse(answer).success) {
      return InitQuestions.refuse(InitQuestions.LANGUAGE_REASON);
    }

    return { ok: true, value: answer };
  }
}
