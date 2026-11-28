import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { GitHubPlatform } from "../../../capability/platform/GitHubPlatform.ts";
import { PlatformError } from "../../../capability/platform/PlatformError.ts";
import { FlowStep, FlowStepBase, Use } from "../../../harness-kit/index.ts";
import { ReviewInputError } from "../../../harnesses/review/ReviewInputError.ts";
import type { ReviewedMergeRequest, ReviewInput } from "../types/review-workflow.ts";

/**
 * Reads the merge request a review is of from its platform, as the first flow step: before git is read for the change
 * and before any model is called, so a merge request that cannot be read costs nothing. A review of no merge request
 * adds none. The tenant is the one `KERPETEN_TENANT` names, `default` when it names none.
 */
@FlowStep({
  name: "merge-request",
  description:
    "Reads the merge request of the review from its platform, with its title, description and commits, before the change is read and before any model call; a review without one adds none.",
})
export class MergeRequestStep extends FlowStepBase {
  public static readonly TENANT_VARIABLE = "KERPETEN_TENANT";

  public static readonly DEFAULT_TENANT = "default";

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @Use(GitHubPlatform)
  private readonly github!: GitHubPlatform;

  public async execute(state: ReviewInput) {
    if (state.mr !== undefined && state.base !== undefined) {
      throw new ReviewInputError("--mr and --base do not go together: the pull request names its own base");
    }

    const mergeRequest = state.mr === undefined ? undefined : await this.read(state.mr);

    if (mergeRequest !== undefined) {
      state.log.info("merge request read", {
        tenant: mergeRequest.tenant,
        platform: mergeRequest.kind,
        host: mergeRequest.host,
        project: mergeRequest.projectId,
        mr: mergeRequest.number,
        state: mergeRequest.state,
        head: mergeRequest.headSha,
        base: mergeRequest.baseSha,
      });
    }

    return { mergeRequest };
  }

  private async read(number: number): Promise<ReviewedMergeRequest> {
    try {
      return { ...(await this.github.mergeRequest(number)), tenant: this.tenant() };
    } catch (error) {
      if (error instanceof PlatformError) throw new ReviewInputError(`--mr ${number}: ${error.message}`);

      throw error;
    }
  }

  private tenant(): string {
    const named = this.env[MergeRequestStep.TENANT_VARIABLE]?.trim();

    return named === undefined || named === "" ? MergeRequestStep.DEFAULT_TENANT : named;
  }
}
