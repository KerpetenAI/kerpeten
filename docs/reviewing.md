# Reviewing

```sh
cd /path/to/your-repository
kerpeten review --dry-run
```

This build only reviews locally: `review` needs `--dry-run`, and nothing is posted to a merge request or sent to the backend yet.

## What is reviewed

The review is of the change between a base and `HEAD`. Without `--base`, the base is the default branch of `origin`; `--base <branch or commit>` names another. The change starts where your branch left the base, so commits that came to the base later are not part of it. When there is no `--base` and `origin` has no default branch set, the review stops and asks for `--base`.

The review is of `HEAD`, but the tools read the files on disk. So `kerpeten review` stops with an error when a tracked file has uncommitted changes, and names the files; commit or stash them first. Untracked files do not matter, because the tools only see files tracked at `HEAD`.

## Extra context

`--extra-context <path>` gives the reviewer and the judge text from outside the repository, such as a ticket, a design note or a team rule; `--extra-context -` reads it from stdin. The text goes into the message of the reviewer and of every judge call as data, in a block of its own. It must be UTF-8 text of at most 20,000 characters: a source that cannot be read, is not text, is empty or is longer stops the review with an error before any model is called, and nothing is cut. There is no `.kerpeten.yml` setting for it, so a reviewed change cannot pull a file into the review.

## Rule files

When the repository root has an `AGENTS.md` or a `CLAUDE.md` tracked at `HEAD`, Kerpeten puts its text into the reviewer's message, as data. The judge does not get it there; it reads the rule lines a finding cites with its tools. Only the text at `HEAD` counts: an untracked rule file is ignored, and a link that leaves the repository is not read and is reported on stderr. When both files have the same text, as when `CLAUDE.md` links to `AGENTS.md`, the text is sent once. A rule file longer than 40,000 characters is cut, and the cut is reported on stderr like a cut diff.

A change that breaks a rule written in these files is a finding with the category `convention`, for example a name that `AGENTS.md` says must be snake_case but that the change writes in camelCase. Its evidence cites the rule line. Rules about how a person or an agent should work, such as which commands to run, are not code rules and are ignored.

## The judge

The candidate filter drops findings whose file or lines do not exist at `HEAD`. Each kept finding then goes to the judge in its own call. When no finding is left after the filter, because the reviewer reported none or the filter dropped them all, the judge is not called.

The judge has its own limits beside the reviewer's; [Configuration](configuration.md#limits) lists them.

## Output

Each finding shows its place, category, title, body, `fix` and evidence, then the judge's `verdict`, `priority`, `nature`, `fix_effort` and `rationale`, the `score` (0-100) and the `action`: `inline` for a comment on its line, `summary` for the summary comment, or `stored` for the run record only. The [`thresholds`](configuration.md#thresholds) in `.kerpeten.yml` set the scores for `inline` and `summary`. A finding the judge could not judge shows its `judge_error` instead of the labels and gets `stored`; the command still exits with 0. Nothing is posted in a dry run, so the action only tells what a posted review would do.

The `fix` is the reviewer's note on how to fix the finding, in one to three sentences, or what has to be checked or decided when the fix is not clear. The judge says in its `rationale` when the note is wrong; the note does not change the verdict or the score.

The usage is reported per role: a `reviewer` entry, and a `judge` entry only when the judge ran, which is the sum of all judge calls. When the change is empty, no model runs and the usage list is empty. `--json` prints `{ "findings": [...], "usage": [...] }` with the same fields. A limit that ends the reviewer early and a limit that ends the judge stage are reported on stderr as separate lines, each with its reason, also with `--json`.
