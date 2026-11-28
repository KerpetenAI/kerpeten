import type { MockLanguageModelV4 } from "ai/test";

export type LanguageModelV4CallOptions = MockLanguageModelV4["doGenerateCalls"][number];

export type LanguageModelV4GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

export interface ScriptedCall {
  readonly name: string;
  readonly input?: unknown;
  readonly raw?: string;
}

export type Scripted =
  | { readonly toolCalls: readonly ScriptedCall[]; readonly text?: string; readonly finish?: "length" }
  | { readonly text: string }
  | { readonly error: Error }
  | { readonly wait: true };

export interface Usage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

export interface ScriptedModel {
  readonly model: MockLanguageModelV4;
  readonly calls: LanguageModelV4CallOptions[];
}
