import type { MockLanguageModelV4 } from "ai/test";

export type ScriptedResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
