import { describe, expect, test } from "bun:test";
import { type Class, IocApplication } from "@asenajs/ioc";
import {
  cliSpec,
  ExitCode,
  KitNames,
  PermissionGroupSet,
  Workflow,
  WorkflowRegistry,
} from "../../../src/harness-kit/index.ts";
import { errorChain, quietLogger } from "../harness-kit-utils.ts";
import { DemoCli } from "./DemoCli.ts";
import { EchoCommand } from "./EchoCommand.ts";
import { EchoStep } from "./EchoStep.ts";
import { EchoTwinCommand } from "./EchoTwinCommand.ts";
import { OtherCli } from "./OtherCli.ts";
import { PlainCli } from "./PlainCli.ts";
import { PlainWorkflow } from "./PlainWorkflow.ts";
import { TwinCli } from "./TwinCli.ts";
import { WaveCommand } from "./WaveCommand.ts";
import { WaveStep } from "./WaveStep.ts";

const COMPONENTS: readonly Class[] = [WorkflowRegistry, DemoCli, EchoCommand, EchoStep, WaveCommand, WaveStep];

async function started(components: readonly Class[], out: string[] = [], err: string[] = []): Promise<IocApplication> {
  const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line) };

  const app = await IocApplication.create({
    components: [...components],
    instances: { [KitNames.IO]: io, [KitNames.PERMISSION_GROUPS]: new PermissionGroupSet({}) },
    logger: quietLogger(),
  });

  await app.start();

  return app;
}

async function startFailure(components: readonly Class[]): Promise<readonly string[]> {
  try {
    await started(components);
  } catch (error) {
    return errorChain(error);
  }

  throw new Error("the start did not fail");
}

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const app = await started(COMPONENTS, out, err);

  try {
    const code = await (await app.resolve(DemoCli)).run(argv);

    return { code, out, err };
  } finally {
    await app.stop();
  }
}

const USAGE = [
  "demo 9.8.7",
  "",
  "usage:",
  "  demo echo --text <text> [--loud | --quiet]",
  "      Print the text.",
  "  demo wave hello | bye",
  "      Wave hello or goodbye.",
  "  demo --version | --help",
  "",
  "echo volume: at most one of --loud, --quiet; --quiet when none is given",
].join("\n");

describe("@CLI and CliBase", () => {
  test("@CLI holds the name, the version and the commands", () => {
    expect(cliSpec(DemoCli)).toMatchObject({ name: "demo", version: "9.8.7" });
  });

  test("help and version come from the @CLI spec", async () => {
    expect(await run("--help")).toEqual({ code: ExitCode.OK, out: [USAGE], err: [] });
    expect(await run("-h")).toEqual({ code: ExitCode.OK, out: [USAGE], err: [] });
    expect(await run("help")).toEqual({ code: ExitCode.OK, out: [USAGE], err: [] });
    expect(await run()).toEqual({ code: ExitCode.USAGE, out: [USAGE], err: [] });
    expect(await run("-v")).toEqual({ code: ExitCode.OK, out: ["9.8.7"], err: [] });
    expect(await run("--version")).toEqual({ code: ExitCode.OK, out: ["9.8.7"], err: [] });
  });

  test("runs a command workflow with the input it makes of the command line and exits with its result", async () => {
    expect(await run("echo", "--text", "hi", "--loud")).toEqual({ code: ExitCode.OK, out: ["HI"], err: [] });

    expect(await run("echo", "--text", "fail")).toEqual({
      code: ExitCode.FAILED,
      out: [],
      err: ["demo echo: asked to fail"],
    });
  });

  test("a command with action words takes one of them first, and its flow steps read the command", async () => {
    expect(await run("wave", "bye")).toEqual({ code: ExitCode.OK, out: ["demo wave bye"], err: [] });

    expect(await run("wave")).toEqual({
      code: ExitCode.USAGE,
      out: [],
      err: ["demo wave: give one of hello, bye", USAGE],
    });

    expect(await run("wave", "hello", "--loud")).toEqual({
      code: ExitCode.USAGE,
      out: [],
      err: ["demo wave: Unknown option '--loud'", USAGE],
    });
  });

  test("an unknown command or a bad argument is a usage error named after the program", async () => {
    expect(await run("nope")).toEqual({ code: ExitCode.USAGE, out: [], err: ['demo: unknown command "nope"', USAGE] });
    expect(await run("echo")).toEqual({ code: ExitCode.USAGE, out: [], err: ["demo echo: --text is required", USAGE] });

    expect((await run("echo", "--text", "a", "--loud", "--quiet")).err[0]).toBe(
      "demo echo: give at most one volume flag, not --loud and --quiet",
    );
  });

  test("a flow step that reads its command outside a command throws, naming the flow step", async () => {
    const app = await started(COMPONENTS);

    expect(await (await app.resolve(EchoCommand)).run({ text: "quiet" })).toBe(ExitCode.OK);

    await expect((await app.resolve(EchoCommand)).run({ text: "fail" })).rejects.toThrow(
      "the flow step echo read its command outside a command; a CLI runs a workflow with a command",
    );

    await app.stop();
  });

  test("a command the CLI lists that is not registered in the container stops the start", async () => {
    expect(await startFailure([WorkflowRegistry, DemoCli, WaveCommand, WaveStep, EchoStep])).toEqual([
      "@OnStart hook 'DemoCli.bindCommands()' failed",
      "the CLI demo lists EchoCommand, which is not registered in the container",
    ]);
  });

  test("a workflow listed by two CLIs stops the start", async () => {
    expect(await startFailure([...COMPONENTS, OtherCli])).toEqual([
      "@OnStart hook 'DemoCli.bindCommands()' failed",
      "the workflow echo is listed by two CLIs, other and demo",
    ]);
  });

  test("a workflow without a command listed by a CLI stops the start", async () => {
    expect(await startFailure([WorkflowRegistry, PlainCli, PlainWorkflow, EchoStep])).toEqual([
      "@OnStart hook 'PlainCli.bindCommands()' failed",
      "the CLI plain lists the workflow plain, which has no command in its @Workflow spec",
    ]);
  });

  test("two listed workflows with one command name stop the start", async () => {
    expect(await startFailure([WorkflowRegistry, TwinCli, EchoCommand, EchoTwinCommand, EchoStep])).toEqual([
      "@OnStart hook 'TwinCli.bindCommands()' failed",
      "the CLI twin lists two commands named echo",
    ]);
  });

  test("a flag of the oneOf group that has the name of an option is refused when the workflow is marked", () => {
    expect(() =>
      Workflow({
        name: "clash",
        description: "Has a flag named like an option.",
        steps: [],
        command: {
          name: "clash",
          usage: "",
          options: { loud: { type: "boolean" } },
          oneOf: { flags: ["loud", "quiet"], fallback: "quiet", label: "volume" },
        },
      }),
    ).toThrow("the clash flag --loud has the name of an option of the command");
  });

  test("a workflow that does not turn a command line into its input says so", () => {
    expect(() => new PlainWorkflow().commandInput({} as never)).toThrow(
      "the workflow plain does not turn a command line into its input; it overrides commandInput",
    );
  });

  test("a class not marked with @CLI has no spec", () => {
    expect(() => cliSpec(EchoCommand)).toThrow("the class is not marked with @CLI");
  });
});
