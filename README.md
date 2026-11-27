# kerpeten

The Kerpeten code review CLI. It reads the change between a base branch and `HEAD`, lets a reviewer model inspect the repository read-only, and prints the findings. A judge model then tries to refute each finding on its own, also read-only, and labels it. A scorer turns the labels into a score and the action a posted review would take.

This build only reviews locally: `review` needs `--dry-run`, and nothing is posted to a merge request or sent to the backend yet.

## Requirements

- [Bun](https://bun.sh) 1.4.5
- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH`
- An API key for the reviewer's provider and one for the judge's provider: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The reviewer and the judge can use different providers and models; when they share a provider, one key serves both. A model with `api_key_env` reads its key from that variable instead. A model with a `base_url` or a key name other than the provider default must be listed in `KERPETEN_TRUSTED_ENDPOINTS` as `<KEY_NAME>=<base_url or provider>`. The command checks the key and the endpoint of both models before it calls either one and stops with a usage error when one is missing or not trusted.

Instead of an API key, a model can use your ChatGPT plan: set its `provider` to `chatgpt` and sign in once with `kerpeten auth login` (see [ChatGPT plan](#chatgpt-plan)).

## Usage

Install the dependencies once, in this repository:

```sh
bun install
```

Add a `.kerpeten.yml` to the root of the repository you want to review:

```yaml
models:
  reviewer:
    provider: anthropic
    model: <model-id>
  judge:
    provider: anthropic
    model: <model-id>
```

Build the binary once and run the review from inside that repository:

```sh
cd /path/to/kerpeten-harness && bun run build -- --target linux-x64
cd /path/to/your-repository
/path/to/kerpeten-harness/dist/kerpeten-linux-x64 review --dry-run
```

The binary runs from any directory. While you work on the harness itself, `scripts/kerpeten.ts` runs it from source in the same way, without a build:

```sh
bun /path/to/kerpeten-harness/scripts/kerpeten.ts review --dry-run
```

Do not start `src/cli/main.ts` directly from another directory: Bun takes the decorator dialect from the `tsconfig.json` of the working directory, and the CLI needs the `experimentalDecorators` setting of this repository's. The launcher passes it with `--tsconfig-override`; the binary has it compiled in.

| Command | What it does |
| --- | --- |
| `kerpeten review --dry-run [--base <rev>] [--context-file <path>] [--json]` | Reviews the change and prints the findings |
| `kerpeten auth login \| logout \| status [--models]` | Signs in with ChatGPT for models with `provider: chatgpt` |
| `kerpeten self-check` | Checks the build without the network |
| `kerpeten capabilities` | Lists what the build can reach (git, the file system, other processes) with the permission each one needs, the permission groups, and the harnesses with the permissions they list |

## ChatGPT plan

A model with `provider: chatgpt` sends its requests to the OpenAI Responses API with the token of your ChatGPT sign-in, so they count against your ChatGPT plan instead of an API key. It takes a `model` and an optional `effort` (`low`, `medium`, `high`, `xhigh` or `max`), and no `api_key_env`, `base_url` or `max_output_tokens`:

```yaml
models:
  reviewer:
    provider: chatgpt
    model: <model-id>
  judge:
    provider: chatgpt
    model: <model-id>
```

| Command | What it does |
| --- | --- |
| `kerpeten auth login` | Prints a sign-in address for your browser, waits for the browser to come back to `127.0.0.1` and saves the sign-in |
| `kerpeten auth status [--models]` | Shows the sign-in; `--models` lists the model ids of your plan |
| `kerpeten auth logout` | Revokes the sign-in at OpenAI and removes the tokens from this machine; when OpenAI does not confirm the revoke, it keeps the tokens and fails, so that you can run it again |

The sign-in is saved in `$XDG_CONFIG_HOME/kerpeten/auth.json`, or `~/.config/kerpeten/auth.json` when `XDG_CONFIG_HOME` is not set. The directory and the file are readable by you only; the review refuses a file that others can read, and Kerpeten refuses a config directory inside a git repository (a repository's `.env` can set `XDG_CONFIG_HOME`). The access token is refreshed when it is close to expiry. Kerpeten signs in under its own name, Kerpeten.

The review stops with an error and prints no findings when there is no sign-in, when the sign-in cannot be refreshed (run `kerpeten auth login`), or when ChatGPT plan usage refuses a request, also in the middle of an answer. A usage limit points to [ChatGPT settings → Usage](https://chatgpt.com/settings/usage). There is no fallback to another provider.

Every request is streamed and sent with `store: false`. Plan usage does not accept an output token limit, so `max_output_tokens` does not apply to these models.

## The judge

The candidate filter drops findings whose file or lines do not exist at `HEAD`. Each kept finding then goes to the judge in its own call. When no finding is left after the filter, because the reviewer reported none or the filter dropped them all, the judge is not called.

The judge has its own limits beside the reviewer's `max_tool_calls` and `max_duration_minutes`, so neither model can spend the other's share. Neither model has a tool call limit unless one is set: `max_tool_calls` (1-1000) for the reviewer, `max_judge_tool_calls` for the judge. All of them are optional:

```yaml
limits:
  max_judge_tool_calls: 15            # tool calls per judge call, 1-1000; left out, there is no limit
  max_judge_parallel: 4               # judge calls at the same time, 1-16; 1 runs them one after another
  max_judge_duration_minutes: 10      # time for the whole judge stage, 1-360
```

The judge's time starts when the judge stage starts, so the longest run is the reviewer's time plus the judge's. When a judge limit ends the stage, the review counts as partial and the findings left unjudged keep a `judge_error`.

## Output

Each finding shows its place, category, title, body and evidence, then the judge's `verdict`, `priority`, `nature`, `fix_effort` and `rationale`, the `score` (0-100) and the `action`: `inline` for a comment on its line, `summary` for the summary comment, or `stored` for the run record only. The `thresholds` in `.kerpeten.yml` set the scores for `inline` and `summary`. A finding the judge could not judge shows its `judge_error` instead of the labels and gets `stored`; the command still exits with 0. Nothing is posted in a dry run, so the action only tells what a posted review would do.

The usage is reported per role: a `reviewer` entry, and a `judge` entry only when the judge ran, which is the sum of all judge calls. When the change is empty, no model runs and the usage list is empty. `--json` prints `{ "findings": [...], "usage": [...] }` with the same fields. A limit that ends the reviewer early and a limit that ends the judge stage are reported on stderr as separate lines, each with its reason, also with `--json`.

## Development

```sh
bun run check
bun run build -- --target linux-x64
```

`check` runs the linter, the type check, the tests and the source layout rules. `build` writes a standalone binary to `dist/`; the targets are `linux-x64`, `linux-arm64` and `darwin-arm64`.
