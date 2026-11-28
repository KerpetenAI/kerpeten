import { dirname, join } from "node:path";
import type { IocLogger } from "@asenajs/ioc";
import { Run } from "@kerpetensh/harness-kit";
import { AiSdkAdapter } from "@kerpetensh/harness-kit/ai-sdk";
import { MockLanguageModelV4 } from "ai/test";
import { API, type Diagnostic } from "typescript/unstable/async";
import type { FileSystem } from "typescript/unstable/fs";
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4GenerateResult,
  Scripted,
  ScriptedModel,
  Usage,
} from "./types/mock.ts";
import type { ProbeDiagnostic } from "./types/probe.ts";

const ids = { call: 0 };

/** A container logger that stays silent but turns a warning, which is always a wiring mistake, into an error. */
export function quietLogger(): IocLogger {
  return {
    info: () => {},
    error: () => {},
    warn: (message) => {
      throw new Error(message);
    },
  };
}

/** The messages of an error and of its causes, outermost first. */
export function errorChain(error: unknown): readonly string[] {
  const messages: string[] = [];

  for (let link: unknown = error; link instanceof Error; link = link.cause) messages.push(link.message);

  return messages;
}

/** A test run whose permission group gives nothing. */
export function noRun(): Run {
  return new Run({ group: "none", every: false, permissions: [] }, { test: true });
}

export function mockClient(script: readonly (Scripted | [Scripted, Usage])[]) {
  const scripted = scriptedModel(script);

  return {
    ...scripted,
    client: new AiSdkAdapter({
      model: scripted.model,
      provider: "anthropic",
      modelId: "mock-model",
      maxOutputTokens: 900,
      maxRetries: 0,
    }),
  };
}

export function limits(
  overrides: Partial<{
    maxToolCalls: number;
    stepDeadline: number;
    finalizeDeadline: number;
  }> = {},
) {
  return {
    maxToolCalls: 10,
    stepDeadline: Number.MAX_SAFE_INTEGER - 1,
    finalizeDeadline: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

function result(scripted: Scripted, usage: Usage = { input: 100, output: 10 }): LanguageModelV4GenerateResult {
  const content: LanguageModelV4GenerateResult["content"] = [];

  if ("text" in scripted && scripted.text !== undefined) content.push({ type: "text", text: scripted.text });

  if ("toolCalls" in scripted) {
    for (const call of scripted.toolCalls) {
      ids.call++;

      content.push({
        type: "tool-call",
        toolCallId: `call-${ids.call}`,
        toolName: call.name,
        input: call.raw ?? JSON.stringify(call.input),
      });
    }
  }

  return {
    content,
    finishReason: {
      unified: "toolCalls" in scripted ? (scripted.finish ?? "tool-calls") : "stop",
      raw: undefined,
    },
    usage: {
      inputTokens: { total: usage.input, noCache: undefined, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite },
      outputTokens: { total: usage.output, text: undefined, reasoning: undefined },
    },
    warnings: [],
  };
}

function scriptedModel(script: readonly (Scripted | [Scripted, Usage])[]): ScriptedModel {
  const calls: LanguageModelV4CallOptions[] = [];
  let index = 0;

  const model = new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-model",
    doGenerate: async (options) => {
      calls.push(options);

      const entry = script[index++];

      if (entry === undefined) throw new Error(`the script has no call ${index}`);

      const [scripted, usage] = Array.isArray(entry) ? entry : [entry, undefined];

      if ("error" in scripted) throw scripted.error;

      if ("wait" in scripted) {
        await new Promise<void>((_resolve, reject) => {
          const signal = options.abortSignal;

          if (signal === undefined) return;
          if (signal.aborted) reject(signal.reason);

          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }

      return result(scripted as Scripted, usage);
    },
  });

  return { model, calls };
}

export function promptText(call: { prompt: unknown } | undefined): string {
  return JSON.stringify(call?.prompt ?? null);
}

function overlay(files: Readonly<Record<string, string>>): FileSystem {
  const folders = new Set(Object.keys(files).map((file) => dirname(file)));

  return {
    readFile: (file) => files[file],
    fileExists: (file) => (Object.hasOwn(files, file) ? true : undefined),
    directoryExists: (folder) => (folders.has(folder) ? true : undefined),
    realpath: (path) => (Object.hasOwn(files, path) ? path : undefined),
  };
}

function flatten(diagnostic: Diagnostic): string[] {
  return [diagnostic.text, ...(diagnostic.messageChain ?? []).flatMap((link) => flatten(link))];
}

/**
 * The type errors of the given sources, compiled with the project's tsconfig.json as files of `test/probes/`, a folder
 * that exists only for the compiler: a source imports the project as a file one folder below `test/` does.
 */
export async function typeErrors(sources: Readonly<Record<string, string>>): Promise<readonly ProbeDiagnostic[]> {
  const root = join(import.meta.dir, "..");
  const folder = join(root, "test", "probes");
  const config = join(folder, "tsconfig.probe.json");

  const files: Record<string, string> = {
    [config]: JSON.stringify({
      extends: "../../tsconfig.json",
      compilerOptions: { noUnusedLocals: false },
      include: [],
      files: Object.keys(sources),
    }),
  };

  for (const [name, text] of Object.entries(sources)) files[join(folder, name)] = text;

  const api = new API({ cwd: root, fs: overlay(files) });

  try {
    const snapshot = await api.updateSnapshot({ openProject: config });
    const project = snapshot.getProject(config);

    if (project === undefined) throw new Error("the probe tsconfig did not open a project");

    const found: ProbeDiagnostic[] = [];

    for (const name of Object.keys(sources)) {
      const file = join(folder, name);
      const text = files[file] ?? "";

      for (const diagnostic of await project.program.getSemanticDiagnostics(file)) {
        found.push({
          file: name,
          line: text.slice(0, diagnostic.pos).split("\n").length,
          code: diagnostic.code,
          text: flatten(diagnostic).join("\n"),
        });
      }
    }

    return found;
  } finally {
    await api.close();
  }
}
