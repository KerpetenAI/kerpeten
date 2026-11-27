import { readText } from "../../files/files-utils.ts";
import { Capability, CapabilityBase } from "../../harness-kit/index.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { issueMessages } from "../../validation/validation-utils.ts";
import { configSchema } from "./schemas/config-schema.ts";
import type { ConfigResult, KerpetenConfig } from "./types/config.ts";

@Capability({
  name: "config-file",
  description: "Reads .kerpeten.yml, checks it against the schema, applies the defaults and hashes the result.",
})
export class ConfigLoader extends CapabilityBase {
  public static readonly CONFIG_FILE = ".kerpeten.yml";

  public static readonly MAX_CONFIG_BYTES = 1_048_576;

  public parse(text: string): ConfigResult {
    let parsed: unknown;

    try {
      parsed = Bun.YAML.parse(text);
    } catch (error) {
      return { ok: false, errors: [`not valid YAML: ${errorMessage(error)}`] };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        errors: ["/: the configuration must be a mapping with at least models.reviewer and models.judge"],
      };
    }

    let data: unknown;

    try {
      data = JSON.parse(JSON.stringify(parsed));
    } catch (error) {
      return { ok: false, errors: [`/: not plain data (${errorMessage(error)})`] };
    }

    const parsedConfig = configSchema.safeParse(data);

    if (!parsedConfig.success) {
      return { ok: false, errors: issueMessages(parsedConfig.error.issues, data) };
    }

    const config = parsedConfig.data;
    const problems = ConfigLoader.semanticProblems(config);

    if (problems.length > 0) return { ok: false, errors: problems };

    return { ok: true, config, hash: this.hash(config) };
  }

  public load(path: string): ConfigResult {
    const file = readText(path, ConfigLoader.MAX_CONFIG_BYTES);

    if (!file.ok) {
      if (file.reason === "missing") {
        return { ok: false, errors: [`${path}: not found; models.reviewer and models.judge must be configured`] };
      }

      return { ok: false, errors: [file.error] };
    }

    const result = this.parse(file.text);

    return result.ok ? result : { ok: false, errors: result.errors.map((error) => `${path}: ${error}`) };
  }

  public static noControlCharacters(text: string): boolean {
    return ![...text].some((character) => character < " ");
  }

  public hash(config: KerpetenConfig): string {
    return new Bun.CryptoHasher("sha256").update(JSON.stringify(ConfigLoader.canonical(config))).digest("hex");
  }

  private static urlProblems(path: string, value: string | undefined, protocols: readonly string[]): string[] {
    if (value === undefined) return [];

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return [`${path}: not a valid URL`];
    }

    if (!protocols.includes(url.protocol)) {
      return [`${path}: must be ${protocols.length === 1 ? "an https" : "an http or https"} URL`];
    }

    if (url.username !== "" || url.password !== "") return [`${path}: must not carry credentials`];

    return [];
  }

  private static semanticProblems(config: KerpetenConfig): string[] {
    const problems: string[] = [];

    for (const role of ["reviewer", "judge"] as const) {
      const model = config.models[role];

      if (model.provider !== "chatgpt") {
        problems.push(...ConfigLoader.urlProblems(`/models/${role}/base_url`, model.base_url, ["https:"]));
      }
    }

    problems.push(...ConfigLoader.urlProblems("/backend/url", config.backend?.url, ["https:", "http:"]));

    return problems;
  }

  private static canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => ConfigLoader.canonical(item));

    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, ConfigLoader.canonical((value as Record<string, unknown>)[key])]),
      );
    }

    return value;
  }
}
