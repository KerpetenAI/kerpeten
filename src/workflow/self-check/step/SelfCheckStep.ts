import { Inject } from "@asenajs/ioc";
import { sdkRoundTrip } from "../../../harness-kit/ai-sdk/index.ts";
import { ExitCode, FlowStep, FlowStepBase, type KitInstances, KitNames } from "../../../harness-kit/index.ts";
import { Prompts } from "../../../harnesses/Prompts.ts";
import { errorMessage } from "../../../text/text-utils.ts";

/** Prints the embedded prompt versions and runs one scripted model round trip; a failed round trip ends with 1. */
@FlowStep({
  name: "self-check",
  description: "Prints the embedded prompt versions and runs one scripted model round trip without the network.",
})
export class SelfCheckStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(Prompts)
  private readonly prompts!: Prompts;

  public async execute(_state: object) {
    const { io } = this;

    for (const line of this.promptLines()) io.out(line);

    const problem = await this.roundTripProblem();

    if (problem !== undefined) {
      io.err(`self-check: ${problem}`);

      return this.end(ExitCode.FAILED);
    }

    io.out("self-check: model SDK round trip passed: tool call, tool result and structured output");

    return {};
  }

  private promptLines(): string[] {
    return this.prompts.roles.map((role) => {
      const version = this.prompts.current[role];
      const text = this.prompts.template(role, version);

      return `self-check: ${role} prompt ${version} embedded, sha256 ${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`;
    });
  }

  private async roundTripProblem(): Promise<string | undefined> {
    try {
      await sdkRoundTrip();

      return undefined;
    } catch (error) {
      return `model SDK round trip: ${errorMessage(error)}`;
    }
  }
}
