import { MockLanguageModelV4 } from "ai/test";
import { PermissionGroupSet } from "../PermissionGroupSet.ts";
import { Run } from "../run/Run.ts";
import { AiSdkAdapter } from "./AiSdkAdapter.ts";
import { ProbeCapability } from "./ProbeCapability.ts";
import { ProbeHarness } from "./ProbeHarness.ts";
import type { ScriptedResult } from "./types/probe.ts";

function scriptedResult(content: ScriptedResult["content"], finish: "tool-calls" | "stop"): ScriptedResult {
  return {
    content,
    finishReason: { unified: finish, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: undefined, reasoning: undefined },
    },
    warnings: [],
  };
}

export async function sdkRoundTrip(): Promise<void> {
  const script: ScriptedResult[] = [
    scriptedResult([{ type: "tool-call", toolCallId: "probe-1", toolName: "probe", input: "{}" }], "tool-calls"),
    scriptedResult([{ type: "text", text: "done" }], "stop"),
    scriptedResult([{ type: "text", text: '{"ok":true}' }], "stop"),
  ];

  let index = 0;

  const model = new MockLanguageModelV4({
    provider: "self-check",
    modelId: "self-check",
    doGenerate: async () => {
      const next = script[index++];

      if (next === undefined) throw new Error("the scripted model has no more answers");

      return next;
    },
  });

  const adapter = new AiSdkAdapter({
    model,
    provider: "anthropic",
    modelId: "self-check",
    maxOutputTokens: 16,
    maxRetries: 0,
  });

  const quiet = () => {};
  const deadline = Date.now() + 60_000;
  const probe = new ProbeCapability();
  const grant = new PermissionGroupSet({}).grant(PermissionGroupSet.ALL);

  const run = await new ProbeHarness().run(undefined, {
    llm: adapter,
    run: new Run(grant, { test: true }).give(ProbeCapability, probe),
    limits: {
      maxToolCalls: 1,
      stepDeadline: deadline,
      finalizeDeadline: deadline,
    },
    now: Date.now,
    log: { debug: quiet, info: quiet, warn: quiet },
  });

  if (probe.calls !== 1) throw new Error("the tool step did not run the probe tool");
  if (run.partialReason !== undefined) throw new Error(`the run stopped early: ${run.partialReason}`);
  if (run.value?.ok !== true) throw new Error(`the structured output failed: ${run.error ?? "no value"}`);
  if (index !== script.length) throw new Error(`the scripted model answered ${index} of ${script.length} calls`);
}
