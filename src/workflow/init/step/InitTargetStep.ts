import { Inject } from "@asenajs/ioc";
import { ExitCode, FlowStep, FlowStepBase, type KitInstances, KitNames, Use } from "@kerpetensh/harness-kit";
import { ConfigFileWriter } from "../../../capability/config/ConfigFileWriter.ts";
import { ConfigLoader } from "../../../capability/config/ConfigLoader.ts";
import { GitRoot } from "../../../capability/git/GitRoot.ts";
import { GitTimeoutError } from "../../../capability/git/GitTimeoutError.ts";
import { errorMessage } from "../../../text/text-utils.ts";

/**
 * Finds the root of the git repository around the working directory; a repository with a `.kerpeten.yml` ends init. A
 * git that does not finish in its time is no mistake of the user: its error is thrown, and the command reports it.
 */
@FlowStep({
  name: "init-target",
  description:
    "Finds the root of the git repository around the working directory and stops before any question when it already has a .kerpeten.yml.",
})
export class InitTargetStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(GitRoot)
  private readonly gitRoot!: GitRoot;

  @Use(ConfigFileWriter)
  private readonly writer!: ConfigFileWriter;

  public async execute(_state: object) {
    let repo: string;

    try {
      repo = await this.gitRoot.root();
    } catch (error) {
      if (error instanceof GitTimeoutError) throw error;

      return this.end(
        this.command.fail(
          ExitCode.USAGE,
          `${errorMessage(error)}; run \`kerpeten init\` inside the repository you want to review`,
        ),
      );
    }

    if (this.writer.taken(repo)) {
      return this.end(this.command.fail(ExitCode.USAGE, ConfigFileWriter.existsMessage(ConfigFileWriter.path(repo))));
    }

    this.io.out(`kerpeten init writes ${ConfigLoader.CONFIG_FILE} to ${repo}. Answer each question on its own line.`);

    return { repo };
  }
}
