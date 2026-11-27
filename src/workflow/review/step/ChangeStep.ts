import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { ContextPackFile } from "../../../capability/context-pack/ContextPackFile.ts";
import { Git } from "../../../capability/git/Git.ts";
import { GitDiff } from "../../../capability/git/GitDiff.ts";
import { HeadCommit } from "../../../capability/git/HeadCommit.ts";
import { FlowStep, FlowStepBase, Use } from "../../../harness-kit/index.ts";
import { Prompts } from "../../../harnesses/Prompts.ts";
import { ReviewInputError } from "../../../harnesses/review/ReviewInputError.ts";
import type { DiscussedFinding } from "../../../harnesses/review/types/review.ts";
import { errorMessage } from "../../../text/text-utils.ts";
import { ReviewReport } from "../ReviewReport.ts";
import type { ReportBasis, ReviewChange, ReviewInput } from "../types/review-workflow.ts";

/**
 * Reads the change between the merge base and the run's HEAD and the known findings of the context file. An empty diff
 * ends the review.
 */
@FlowStep({
  name: "change",
  description:
    "Reads the change between the merge base and HEAD and the known findings of the context file; an empty change ends the review.",
})
export class ChangeStep extends FlowStepBase {
  private static readonly LISTED_FILES = 10;

  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(Prompts)
  private readonly prompts!: Prompts;

  @Inject(ContextPackFile)
  private readonly contextPacks!: ContextPackFile;

  @Use(Git)
  private readonly git!: Git;

  @Use(GitDiff)
  private readonly diff!: GitDiff;

  @Use(HeadCommit)
  private readonly head!: HeadCommit;

  private static uncommittedMessage(files: readonly string[]): string {
    const rest = files.length - ChangeStep.LISTED_FILES;
    const count = files.length === 1 ? "1 tracked file has" : `${files.length} tracked files have`;
    const listed = files.slice(0, ChangeStep.LISTED_FILES).join(", ");
    const more = rest > 0 ? ` and ${rest} more` : "";

    return `${count} uncommitted changes: ${listed}${more}; the tools read the files on disk but the review is of HEAD, so commit or stash the changes and run again`;
  }

  public async execute(state: ReviewInput) {
    const { config, log } = state;
    const { git } = this;
    const start = this.now();
    const head = this.head.sha;
    const baseRev = state.base ?? (await git.defaultRemoteBranch());

    if (baseRev === undefined) {
      throw new ReviewInputError("no --base given and origin/HEAD is not set; pass --base <branch or commit>");
    }

    let baseSha: string;

    try {
      baseSha = await git.mergeBase(await git.resolveCommit(baseRev), head);
    } catch (error) {
      throw new ReviewInputError(`cannot use ${baseRev} as the base: ${errorMessage(error)}`);
    }

    let known: DiscussedFinding[] = [];

    if (state.contextFile !== undefined) {
      const context = this.contextPacks.read(state.contextFile);

      if (!context.ok) throw new ReviewInputError(context.error);

      known = context.pack.known.map((item) => ({
        title: item.title,
        file: item.file,
        ...(item.reason === undefined ? {} : { reason: item.reason }),
      }));
    }

    const uncommitted = await git.changedTrackedFiles();

    if (uncommitted.length > 0) throw new ReviewInputError(ChangeStep.uncommittedMessage(uncommitted));

    const changes = await this.diff.between(baseSha, head, config.ignore);
    const changedFiles = GitDiff.changedPaths(changes.files);
    const prompts = this.prompts.current;
    const basis: ReportBasis = { baseSha, headSha: head, changedFiles, promptVersion: prompts.reviewer };

    if (changes.patch.trim() === "") {
      log.info("nothing to review", { base: baseSha, head });

      return this.end(ReviewReport.empty(basis));
    }

    const branch = await git.currentBranch();

    const change: ReviewChange = {
      ...basis,
      start,
      patch: changes.patch,
      title: branch ?? head,
      description: await git.commitMessages(baseSha, head),
      known,
      judgePromptVersion: prompts.judge,
    };

    return { change };
  }
}
