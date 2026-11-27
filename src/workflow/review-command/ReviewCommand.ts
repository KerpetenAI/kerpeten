import { Git } from "../../capability/git/Git.ts";
import { PermissionGroups } from "../../capability/PermissionGroups.ts";
import {
  type After,
  type CommandArgs,
  ExitCode,
  PermissionGroupSet,
  UsageError,
  Workflow,
  WorkflowBase,
} from "../../harness-kit/index.ts";
import { ReviewInputError } from "../../harnesses/review/ReviewInputError.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { ReviewWorkflow } from "../review/ReviewWorkflow.ts";
import { planStopMessage } from "./review-command-utils.ts";
import { ReviewFlagStep } from "./step/ReviewFlagStep.ts";
import { ReviewOutcomeStep } from "./step/ReviewOutcomeStep.ts";
import { ReviewPrintStep } from "./step/ReviewPrintStep.ts";
import { ReviewSetupStep } from "./step/ReviewSetupStep.ts";
import type { ReviewFlags } from "./types/review-command.ts";

/**
 * The `review` command: checks the flags, gets the review ready, runs the local review workflow, which it lists in its
 * chain and which joins its run of the flag's permission group, and prints the result. An error of the local review ends the command
 * with 2 when the input was wrong and with 1 otherwise, or with the ChatGPT plan's stop when the plan stopped it.
 */
@Workflow({
  name: "review-command",
  description:
    "Review the change between the base branch and HEAD and print the findings. The reviewer model finds them, the judge model checks and labels each one, and the scorer gives it a score and the action a posted review would take. Both models only read the repository. This build needs --dry-run.",
  steps: [ReviewFlagStep, ReviewSetupStep, ReviewWorkflow, ReviewOutcomeStep, ReviewPrintStep],
  command: {
    name: "review",
    usage: "[--dry-run] [--full] [--base <rev>] [--context-file <path>] [--json]",
    options: {
      "dry-run": { type: "boolean" },
      full: { type: "boolean" },
      base: { type: "string" },
      "context-file": { type: "string" },
      json: { type: "boolean" },
    },
    oneOf: {
      flags: PermissionGroups.SET.names,
      fallback: PermissionGroupSet.ALL,
      label: "permission group",
    },
  },
})
export class ReviewCommand extends WorkflowBase<ReviewFlags, After<typeof ReviewPrintStep>, number> {
  public override commandInput(args: CommandArgs): ReviewFlags {
    const base = args.string("base");

    if (base !== undefined) {
      try {
        Git.assertRevision(base);
      } catch {
        throw new UsageError("--base must be a commit or branch name");
      }
    }

    const contextFile = args.string("context-file");

    if (contextFile !== undefined && (contextFile === "" || contextFile.includes("\0"))) {
      throw new UsageError("--context-file needs a path");
    }

    return {
      dryRun: args.boolean("dry-run"),
      full: args.boolean("full"),
      json: args.boolean("json"),
      group: args.choice(),
      ...(base === undefined ? {} : { base }),
      ...(contextFile === undefined ? {} : { contextFile }),
    };
  }

  /** The flag's permission group; the local review's harnesses are checked against it when it joins the run. */
  protected override group(input: ReviewFlags): string {
    return input.group;
  }

  /**
   * Turns an error of the local review into the exit code, as the command reports it. An error before the review is
   * ready or after its result is no review error and is thrown.
   */
  protected override rescue(error: unknown, state: ReviewFlags & Partial<After<typeof ReviewPrintStep>>): number {
    if (state.config === undefined || state.findings !== undefined) throw error;

    const failure = state.plan?.adapter.failure;

    if (failure !== undefined) return this.command.fail(ExitCode.FAILED, planStopMessage(failure));

    return this.command.fail(error instanceof ReviewInputError ? ExitCode.USAGE : ExitCode.FAILED, errorMessage(error));
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}
