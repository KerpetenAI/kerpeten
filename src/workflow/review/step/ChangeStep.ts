import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase, Use } from "@kerpetensh/harness-kit";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { ContextPackFile } from "../../../capability/context-pack/ContextPackFile.ts";
import { ExtraContextFile } from "../../../capability/extra-context/ExtraContextFile.ts";
import { Git } from "../../../capability/git/Git.ts";
import { GitDiff } from "../../../capability/git/GitDiff.ts";
import { HeadCommit } from "../../../capability/git/HeadCommit.ts";
import { PlatformWords } from "../../../capability/platform/PlatformWords.ts";
import { Prompts } from "../../../harnesses/Prompts.ts";
import { ReviewInputError } from "../../../harnesses/review/ReviewInputError.ts";
import type { DiscussedFinding } from "../../../harnesses/review/types/review.ts";
import { errorMessage } from "../../../text/text-utils.ts";
import { ReviewReport } from "../ReviewReport.ts";
import type { ReportBasis, ReviewChange, ReviewedMergeRequest } from "../types/review-workflow.ts";
import type { MergeRequestStep } from "./MergeRequestStep.ts";

/**
 * Reads the change between the merge base and the run's HEAD, the known findings of the context file and the extra
 * context. An empty diff ends the review.
 *
 * A review of a merge request is of the merge request's last commit: HEAD must be that commit, and this is checked
 * first, before the uncommitted changes and before the diff, so a working copy at another commit costs no model call.
 * Its base is the merge base of the merge request's base commit and HEAD, and the reviewer gets its title and its
 * description; the commit messages stand in for an empty description. What it tells the user about the merge request
 * is in the words of its platform: a pull request and `gh` on GitHub, a merge request and `glab` on GitLab.
 */
@FlowStep({
  name: "change",
  description:
    "Reads the change between the merge base and HEAD, the known findings of the context file and the extra context; for a merge request it first requires HEAD to be its last commit; an empty change ends the review.",
})
export class ChangeStep extends FlowStepBase {
  private static readonly LISTED_FILES = 10;

  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(Prompts)
  private readonly prompts!: Prompts;

  @Inject(ContextPackFile)
  private readonly contextPacks!: ContextPackFile;

  @Inject(ExtraContextFile)
  private readonly extraContexts!: ExtraContextFile;

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

  private static otherCommitMessage(mergeRequest: ReviewedMergeRequest, head: string): string {
    const { number } = mergeRequest;
    const words = PlatformWords.of(mergeRequest.kind);

    return `HEAD is at ${head} but ${words.noun} ${number} is at ${mergeRequest.headSha}; the review is of the ${words.noun}'s last commit, so run \`${words.checkoutCommand(number)}\`, or push your commits, and run again`;
  }

  public async execute(state: After<typeof MergeRequestStep>) {
    const { config, log, mergeRequest } = state;
    const { git } = this;
    const start = this.now();
    const head = this.head.sha;

    if (mergeRequest !== undefined && mergeRequest.headSha !== head) {
      throw new ReviewInputError(ChangeStep.otherCommitMessage(mergeRequest, head));
    }

    const baseSha =
      mergeRequest === undefined
        ? await this.branchBase(state.base, head)
        : await this.mergeRequestBase(mergeRequest, head);

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

    let extraContext: string | undefined;

    if (state.extraContext !== undefined) {
      const read = await this.extraContexts.read(state.extraContext);

      if (!read.ok) throw new ReviewInputError(`--extra-context ${read.error}`);

      extraContext = read.text;
    }

    const changes = await this.diff.between(baseSha, head, config.ignore);
    const changedFiles = GitDiff.changedPaths(changes.files);
    const prompts = this.prompts.current;

    const basis: ReportBasis = {
      baseSha,
      headSha: head,
      changedFiles,
      promptVersion: prompts.reviewer,
      ...(mergeRequest === undefined ? {} : { mergeRequest }),
    };

    if (changes.patch.trim() === "") {
      log.info("nothing to review", { base: baseSha, head });

      return this.end(ReviewReport.empty(basis));
    }

    const described = mergeRequest !== undefined && mergeRequest.description.trim() !== "";

    const change: ReviewChange = {
      ...basis,
      start,
      patch: changes.patch,
      title: mergeRequest?.title ?? (await git.currentBranch()) ?? head,
      description: described ? mergeRequest.description : await git.commitMessages(baseSha, head),
      known,
      ...(extraContext === undefined ? {} : { extraContext }),
      judgePromptVersion: prompts.judge,
    };

    return { change };
  }

  private async branchBase(base: string | undefined, head: string): Promise<string> {
    const baseRev = base ?? (await this.git.defaultRemoteBranch());

    if (baseRev === undefined) {
      throw new ReviewInputError("no --base given and origin/HEAD is not set; pass --base <branch or commit>");
    }

    try {
      return await this.git.mergeBase(await this.git.resolveCommit(baseRev), head);
    } catch (error) {
      throw new ReviewInputError(`cannot use ${baseRev} as the base: ${errorMessage(error)}`);
    }
  }

  private async mergeRequestBase(mergeRequest: ReviewedMergeRequest, head: string): Promise<string> {
    const { baseSha, number } = mergeRequest;
    const { noun } = PlatformWords.of(mergeRequest.kind);

    if (!(await this.git.hasCommit(baseSha))) {
      throw new ReviewInputError(
        `the base commit ${baseSha} of ${noun} ${number} is not in this repository; fetch the branch the ${noun} goes into with \`git fetch origin\`, and run again`,
      );
    }

    try {
      return await this.git.mergeBase(baseSha, head);
    } catch (error) {
      throw new ReviewInputError(`cannot use the base commit of ${noun} ${number}: ${errorMessage(error)}`);
    }
  }
}
