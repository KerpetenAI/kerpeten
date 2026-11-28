# Configuration

Kerpeten reads its settings from `.kerpeten.yml` in the root of the repository you review. `kerpeten init` asks a few questions and writes the file for you; it never changes a `.kerpeten.yml` that is already there. Commit the file so that everyone on the project reviews with the same settings.

You can also write the file by hand. Only `models` is required:

```yaml
models:
  reviewer:
    provider: anthropic
    model: <model-id>
  judge:
    provider: anthropic
    model: <model-id>
```

## Requirements

- [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on `PATH`
- An API key for the reviewer's provider and one for the judge's provider: `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. The reviewer and the judge can use different providers and models; when they share a provider, one key serves both. A model with `api_key_env` reads its key from that variable instead. A model with a `base_url` or a key name other than the provider default must be listed in `KERPETEN_TRUSTED_ENDPOINTS` as `<KEY_NAME>=<base_url or provider>`. The command checks the key and the endpoint of both models before it calls either one and stops with a usage error when one is missing or not trusted.

Instead of an API key, a model can use your ChatGPT plan: set its `provider` to `chatgpt` and sign in once with `kerpeten auth login` (see [ChatGPT plan](chatgpt-plan.md)).

## Models

A model has a `provider` (`anthropic`, `openai`, `openrouter` or `chatgpt`) and a `model`, the model id as the provider writes it.

A model takes an optional `max_output_tokens` (1-1000000). Left out, Kerpeten sets no limit of its own: OpenAI and OpenRouter get no limit, and Anthropic, whose API needs one on every request, gets the limit of the model. An Anthropic model behind another `base_url` must have `max_output_tokens`, because the limit of that model is not known: without it the review stops before any model is called. A model on Anthropic's own API that the SDK does not know yet fails on its first request with an error that asks for the same setting.

When the final answer of the reviewer or the judge comes back empty or does not fit the expected form, the same request is sent again, up to three times in all. If all three fail, the review ends as before: a reviewer without an answer ends the review with an error, a judge without an answer leaves a `judge_error` on that finding.

## Another endpoint

A model with a `base_url` sends its requests there instead of to the provider. The address must start with `https://`. `api_key_env` names the variable that holds the key for it; the name must end in `_API_KEY`. The pair must be listed in `KERPETEN_TRUSTED_ENDPOINTS` as `<KEY_NAME>=<base_url>`, so that a `.kerpeten.yml` in a repository cannot send your key to an address you did not choose. Several entries are separated by a comma or a space:

```yaml
models:
  reviewer:
    provider: openai
    model: <model-id>
    base_url: https://llm.example.com/v1
    api_key_env: EXAMPLE_API_KEY
  judge:
    provider: openai
    model: <model-id>
    base_url: https://llm.example.com/v1
    api_key_env: EXAMPLE_API_KEY
```

```sh
export EXAMPLE_API_KEY=<your key>
export KERPETEN_TRUSTED_ENDPOINTS=EXAMPLE_API_KEY=https://llm.example.com/v1
```

## Comment language

`comment_language` is the language the findings are written in, as a language tag such as `en`, `tr` or `pt-BR`. It is `en`, English, when left out.

```yaml
comment_language: tr
```

## Ignored files

`ignore` is a list of glob patterns. A changed file that matches one is left out of the diff. Left out, the list is `**/*.lock` and `**/generated/**`.

```yaml
ignore:
  - "**/*.lock"
  - "**/generated/**"
  - "**/*.snap"
```

## Limits

Neither model has a tool call limit unless one is set: `max_tool_calls` (1-1000) for the reviewer, `max_judge_tool_calls` for the judge. Both time limits are 60 minutes when left out; they are there to end a stuck run, not to cut the work short. The judge has its own limits beside the reviewer's, so neither model can spend the other's share. All of them are optional:

```yaml
limits:
  max_tool_calls: 40                  # tool calls of the reviewer, 1-1000; left out, there is no limit
  max_duration_minutes: 60            # time for the reviewer, 1-360; 60 when left out
  max_judge_tool_calls: 15            # tool calls per judge call, 1-1000; left out, there is no limit
  max_judge_parallel: 4               # judge calls at the same time, 1-16; 1 runs them one after another
  max_judge_duration_minutes: 60      # time for the whole judge stage, 1-360; 60 when left out
```

The judge's time starts when the judge stage starts, so the longest run is the reviewer's time plus the judge's. When a judge limit ends the stage, the review counts as partial and the findings left unjudged keep a `judge_error`.

## Thresholds

The `thresholds` set the scores for the actions `inline` and `summary` (see [the output](reviewing.md#output)). A finding that scores `inline` or more becomes a comment on its line, one that scores `summary` or more goes into the summary comment, and a lower one is only stored. `summary` must not be above `inline`.

```yaml
thresholds:
  inline: 60     # 60 when left out
  summary: 20    # 20 when left out
```
