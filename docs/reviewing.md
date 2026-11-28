# Reviewing

```sh
cd /path/to/your-repository
kerpeten review --dry-run
```

This build only reviews locally: `review` needs `--dry-run`, and nothing is posted to a merge request or sent to the backend yet.

## What is reviewed

The review is of the change between a base and `HEAD`. Without `--base`, the base is the default branch of `origin`; `--base <branch or commit>` names another. The change starts where your branch left the base, so commits that came to the base later are not part of it. When there is no `--base` and `origin` has no default branch set, the review stops and asks for `--base`.

The review is of `HEAD`, but the tools read the files on disk. So `kerpeten review` stops with an error when a tracked file has uncommitted changes, and names the files; commit or stash them first. Untracked files do not matter, because the tools only see files tracked at `HEAD`.

## Reviewing a pull request

```sh
gh pr checkout 12
kerpeten review --dry-run --mr 12
```

`--mr <n>` reviews pull request `n` of the GitHub repository in the current folder. Kerpeten reads the pull request with the GitHub CLI, `gh`, so it uses the sign-in of `gh` and holds no GitHub token of its own. The reviewer gets the title and the description of the pull request instead of the branch name and the commit messages; when the description is empty, it gets the commit messages. The title and the description are data for the models, like the diff.

It needs three things:

- `gh` installed and signed in (`gh auth login`), in a clone whose remote is on GitHub.
- The working copy at the last commit of the pull request. `gh pr checkout <n>` gets it. The review is of that commit, so `HEAD` at another commit stops the review.
- The commit of the branch the pull request goes into, in the local repository. `git fetch origin` gets it.

The change is the one between that base commit and `HEAD`, from where the branch left the base. So `--mr` and `--base` do not go together.

The order is fixed, so that a review that cannot run costs nothing: first `gh` reads the pull request, then `HEAD` is checked against its last commit, then the uncommitted changes are checked, then the diff is made. Only after all of that is a model called.

What it does not do yet: it posts nothing. No comment is written to the pull request, and the comments that are already there are not read for the review. `--dry-run` is still needed.

The text output starts with one line for the pull request, and `--json` has a `merge_request` object:

```json
{
  "merge_request": {
    "tenant": "default",
    "platform": { "kind": "github", "host": "github.com" },
    "project": { "id": "1296269" },
    "mr": 12,
    "title": "Add a division helper",
    "state": "open",
    "head_sha": "69435fefd9f2c0a4b4f4f6d0e3c1a2b3c4d5e6f7",
    "base_sha": "524f2b14fb27a1b2c3d4e5f60718293a4b5c6d7e"
  }
}
```

`project.id` is GitHub's id of the repository, and `state` is `open`, `closed` or `merged`. `tenant` is the value of the environment variable `KERPETEN_TENANT`, and `default` when it is not set or empty.

Each of these stops the review with exit code 2 before any model is called, and says what to do:

| Error | What to do |
| --- | --- |
| `gh` is not found | Install the GitHub CLI from <https://cli.github.com> |
| `gh` is not signed in | Run `gh auth login` |
| The pull request was not found | Check the number, and that the sign-in of `gh` can read the repository |
| `gh` finds no GitHub repository in the folder | Run inside a clone whose remote is on GitHub |
| `HEAD` is not the last commit of the pull request | Run `gh pr checkout <n>`, or push your commits |
| The base commit is not in the repository | Run `git fetch origin` |
| `--mr` is not a whole number of 1 or more, or `--base` is given too | Fix the command line |

Any other failure of `gh` stops the review the same way, with the error text of `gh`.

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

The usage is reported per role: a `reviewer` entry, and a `judge` entry only when the judge ran, which is the sum of all judge calls. When the change is empty, no model runs and the usage list is empty. `--json` prints `{ "findings": [...], "usage": [...] }` with the same fields, and with `--mr` a [`merge_request`](#reviewing-a-pull-request) object before them. A limit that ends the reviewer early and a limit that ends the judge stage are reported on stderr as separate lines, each with its reason, also with `--json`.
