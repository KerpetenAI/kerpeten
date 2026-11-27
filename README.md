# Kerpeten

[![npm](https://img.shields.io/npm/v/kerpeten?style=flat-square)](https://www.npmjs.com/package/kerpeten)
[![ci](https://img.shields.io/github/actions/workflow/status/KerpetenSH/kerpeten/ci.yml?branch=master&style=flat-square&label=ci)](https://github.com/KerpetenSH/kerpeten/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/kerpeten?style=flat-square)](https://github.com/KerpetenSH/kerpeten/blob/master/LICENSE)

**AI code review in your terminal, where a second model checks every finding.**

Kerpeten reads the change on your branch and lets a reviewer model look for defects in it. Then a judge model takes each finding on its own and tries to refute it against the code. What you get is a list of findings, each with a verdict, a score and a note on how to fix it.

- **Two models, not one.** The reviewer finds, the judge doubts. A finding the judge refutes gets a score of 0, so a wrong guess does not look like a real defect.
- **Read-only.** The models can read and search the files of your repository, and nothing else. They cannot change a file or run a command.
- **Your models.** Anthropic, OpenAI, OpenRouter, or your ChatGPT plan instead of an API key. The reviewer and the judge can be different models.
- **Your rules.** A change that breaks a rule written in your `AGENTS.md` or `CLAUDE.md` is a finding too.
- **No silent fallback.** A missing key stops the review with a clear error. When a limit ends the review early or a long input is cut, Kerpeten reports it. It never switches to another model on its own.

> **Status:** Kerpeten is at an early stage. Today it reviews on your machine and prints the findings. It does not post the review to a merge request yet.

## What a review looks like

Two of the four findings of a real run on a small test repository. The comments were written in Turkish and are translated here.

```text
review: 524f2b14fb27..69435fefd9f2, 2 changed files, prompt reviewer v4
findings: 4
- src/flows/partialRefund.ts:10-10 [bug] The handling fee is not rounded down to whole cents.
  verdict verified, priority P1, nature critical, fix_effort easy, score 70, action inline
  For a request of 100 cents the 1.5% fee is taken as 1.5 cents instead of being rounded down to 1 cent. The flow returns 98.5 cents instead of 99.
  fix Round the handling fee down to whole cents before you take it from the refund.
  rationale A request of 100 cents passes the check for a positive amount, and the fee of 1.5 cents is taken without rounding, so the flow returns 98.5 cents instead of 99.
  evidence src/flows/partialRefund.ts:10: The percentage is stored without rounding, so it can be a part of a cent.
  evidence src/flows/partialRefund.ts:12: The fee is taken from the requested amount as it is.
  evidence AGENTS.md:6: Money must be a whole number of cents.
- src/flows/partialRefund.ts:6-6 [convention] The id of the partial refund flow is not in snake_case.
  verdict verified, priority P2, nature critical, fix_effort easy, score 45, action summary
  The `id` of the new flow is `partialRefund`; the project rule says that flow ids are written in snake_case.
  fix Change the `id` to `partial_refund`.
  rationale `AGENTS.md` says that the ids of the flows under `src/flows/` are in snake_case; the `id` of the new flow is `partialRefund`, which is camelCase.
  evidence AGENTS.md:5: The `id` fields of the flows under `src/flows/` must be in snake_case.
  evidence src/flows/partialRefund.ts:6: The `id` of the new flow is `partialRefund`, in camelCase.
```

## Quick start

1. Install Kerpeten:

   ```sh
   npm install -g kerpeten
   ```

   It also needs [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on your `PATH`; the models search your code with it.

2. Add a `.kerpeten.yml` to the root of the repository you want to review:

   ```yaml
   models:
     reviewer:
       provider: anthropic
       model: <model-id>
     judge:
       provider: anthropic
       model: <model-id>
   comment_language: en
   ```

3. Give Kerpeten the key of your provider:

   ```sh
   export ANTHROPIC_API_KEY=<your key>
   ```

4. Commit your work, then run the review from inside the repository:

   ```sh
   kerpeten review --dry-run
   ```

The review covers the commits of your branch that are not on the default branch of `origin`. `--base <branch or commit>` picks another base.

## Models

| `provider` | What it needs |
| --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `chatgpt` | A sign-in with `kerpeten auth login`; the requests count against your ChatGPT plan |

Another endpoint that speaks the API of one of these providers works too, with `base_url` and `api_key_env`. [Configuration](https://github.com/KerpetenSH/kerpeten/blob/master/docs/configuration.md) tells how.

## How it works

1. **Change.** Kerpeten takes the diff between the base and `HEAD`.
2. **Reviewer.** The reviewer model reads the diff and the rule files, looks into the repository with its read-only tools and reports findings. Each one names a file, lines, a category, the evidence and a fix.
3. **Filter.** Findings that point to a file or to lines that do not exist are dropped.
4. **Judge.** Each finding goes to the judge model in its own call. The judge checks it against the code and labels it: `verified`, `unverified` or `refuted`, with a priority, a nature and the effort of the fix.
5. **Scorer.** The labels become a score from 0 to 100. The score decides what a posted review would do with the finding: a comment on its line, a line in the summary, or nothing.

## Commands

| Command | What it does |
| --- | --- |
| `kerpeten review --dry-run [--base <rev>] [--context-file <path>] [--extra-context <path or ->] [--json]` | Reviews the change and prints the findings |
| `kerpeten auth login \| logout \| status [--models]` | Signs in with ChatGPT for models with `provider: chatgpt` |
| `kerpeten self-check` | Checks the build without the network |
| `kerpeten capabilities` | Lists what the build can reach (git, the file system, other processes) with the permission each one needs, the permission groups, and the harnesses with the permissions they list |

## Platforms

The npm package brings a ready binary for Linux (x64 and arm64, glibc) and for macOS (arm64). npm picks the one for your machine; Node.js 18 or later is needed only for the small launcher that starts it. There is no build yet for Windows, for Intel Macs or for a musl Linux such as Alpine: on those the `kerpeten` command stops with an error that says so.

## Documentation

- [Configuration](https://github.com/KerpetenSH/kerpeten/blob/master/docs/configuration.md): models, keys, other endpoints, the comment language, limits and thresholds
- [Reviewing](https://github.com/KerpetenSH/kerpeten/blob/master/docs/reviewing.md): what is reviewed, extra context, rule files, the judge and the output
- [ChatGPT plan](https://github.com/KerpetenSH/kerpeten/blob/master/docs/chatgpt-plan.md): the sign-in and how plan usage behaves
- [Development](https://github.com/KerpetenSH/kerpeten/blob/master/docs/development.md): running from source, the checks and the builds
- [Releasing](https://github.com/KerpetenSH/kerpeten/blob/master/RELEASING.md): how a version gets to npm

## License

MIT, see [LICENSE](https://github.com/KerpetenSH/kerpeten/blob/master/LICENSE). Written by LibirSoft.
