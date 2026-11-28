# ChatGPT plan

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
