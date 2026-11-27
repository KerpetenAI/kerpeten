import { z } from "zod";
import type { Model } from "../../../api/types/api.generated.ts";
import type { Effort, KeyProvider } from "../../../harness-kit/ai-sdk/index.ts";
import { ConfigLoader } from "../ConfigLoader.ts";

const PROVIDERS = ["openrouter", "anthropic", "openai"] as const satisfies readonly (Model["provider"] & KeyProvider)[];

const EFFORTS = ["low", "medium", "high"] as const satisfies readonly (NonNullable<Model["effort"]> & Effort)[];

const CHATGPT_EFFORTS = [...EFFORTS, "xhigh", "max"] as const satisfies readonly Effort[];

const RESERVED_KEY_ENV = /^(CI_|GITHUB_|GITLAB_|GLAB_|GH_|KERPETEN_|ACTIONS_|RUNNER_)/;

const CONTROL_MESSAGE = "must not contain control characters";

const httpsUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s/@?#]+(\/\S*)?$/u);

const httpUrl = z
  .string()
  .max(2048)
  .regex(/^https?:\/\/[^\s/@?#]+(\/\S*)?$/u);

const HUNDREDTHS = 100;

const points = z
  .number()
  .min(0)
  .max(100)
  .multipleOf(0.01)
  .transform((value) => Math.round(value * HUNDREDTHS) / HUNDREDTHS);

const multiplier = z.number().min(0).max(1);

const modelId = z
  .string()
  .min(1)
  .max(200)
  .regex(/^\S+$/u)
  .refine((text) => ConfigLoader.noControlCharacters(text), CONTROL_MESSAGE);

const keyModel = z.strictObject({
  provider: z.enum(PROVIDERS),
  model: modelId,
  base_url: httpsUrl.optional(),
  api_key_env: z
    .string()
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*_API_KEY$/)
    .refine((name) => !RESERVED_KEY_ENV.test(name), "must not name a CI, platform, runner or Kerpeten variable")
    .optional(),
  max_output_tokens: z.int().min(1).max(1_000_000).default(16000),
  effort: z.enum(EFFORTS).optional(),
});

/**
 * A model used through the ChatGPT plan of the user signed in with `kerpeten auth login`. It takes no key, no
 * endpoint and no output token limit: the token comes from the sign-in, the endpoint is fixed and plan usage does
 * not accept an output token limit. Its `effort` also takes `xhigh` and `max`.
 */
const chatgptModel = z.strictObject({
  provider: z.literal("chatgpt"),
  model: modelId,
  effort: z.enum(CHATGPT_EFFORTS).optional(),
});

const model = z.discriminatedUnion("provider", [keyModel, chatgptModel]);

export const scoringSchema = z
  .strictObject({
    priority: z.strictObject({ P0: points.default(60), P1: points.default(35), P2: points.default(10) }).prefault({}),
    nature: z.strictObject({ critical: points.default(25), edge_case: points.default(5) }).prefault({}),
    fix_effort: z.strictObject({ easy: points.default(10), hard: points.default(0) }).prefault({}),
    verdict: z.strictObject({ verified: multiplier.default(1), unverified: multiplier.default(0.5) }).prefault({}),
  })
  .prefault({});

/**
 * Score thresholds from `.kerpeten.yml`. A finding that scores `inline` or more becomes a comment on its line,
 * one that scores `summary` or more goes into the summary comment, and a lower one is only stored.
 */
export const thresholdsSchema = z
  .strictObject({ inline: points.default(60), summary: points.default(20) })
  .refine((thresholds) => thresholds.summary <= thresholds.inline, "summary must not be above inline")
  .prefault({});

export const scoringConfigSchema = z.strictObject({ scoring: scoringSchema, thresholds: thresholdsSchema });

/** The limits of the judge flow step from `.kerpeten.yml`; the judge flow step checks its own limits against the same bounds. */
export const judgeLimitsSchema = z.strictObject({
  max_judge_tool_calls: z.int().min(1).max(1000).optional(),
  max_judge_parallel: z.int().min(1).max(16).default(4),
  max_judge_duration_minutes: z.int().min(1).max(360).default(60),
});

export const configSchema = z.strictObject({
  models: z.strictObject({ reviewer: model, judge: model }),
  backend: z.strictObject({ url: httpUrl.optional() }).optional(),
  scoring: scoringSchema,
  thresholds: thresholdsSchema,
  limits: z
    .strictObject({
      max_inline_comments: z.int().min(0).max(100).default(10),
      max_tool_calls: z.int().min(1).max(1000).optional(),
      max_duration_minutes: z.int().min(1).max(360).default(60),
      ...judgeLimitsSchema.shape,
    })
    .prefault({}),
  ignore: z
    .array(
      z
        .string()
        .min(1)
        .max(512)
        .regex(/^(?!\/)(?!\.\/)(?!!)/u)
        .refine((text) => ConfigLoader.noControlCharacters(text), CONTROL_MESSAGE),
    )
    .max(200)
    .default(() => ["**/*.lock", "**/generated/**"]),
  comment_language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .default("tr"),
  openrouter: z.strictObject({ zdr: z.boolean().default(true) }).prefault({}),
});
