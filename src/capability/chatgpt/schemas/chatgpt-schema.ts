import { z } from "zod";

const text = z.string().min(1).max(16_384);

export const storedTokensSchema = z.strictObject({
  access_token: text,
  refresh_token: text,
  token_type: z.string().max(64),
  scopes: z.array(z.string().max(256)).max(64),
  expires_at: z.int().nonnegative(),
  earliest_refresh_at: z.int().nonnegative().optional(),
  saved_at: z.string().max(64),
});

/**
 * The sign-in record in `auth.json`. `host_id` and `client_id` stay after `kerpeten auth logout`, so a later
 * sign-in on this machine reuses the registration; `tokens` goes.
 */
export const authRecordSchema = z.strictObject({
  version: z.literal(1),
  host_id: z
    .string()
    .max(128)
    .regex(/^urn:uuid:[0-9a-f-]{36}$/u),
  client_id: z.string().min(1).max(256).optional(),
  issuer: z.string().max(256).optional(),
  subject: z.string().min(1).max(256).optional(),
  email: z.string().max(320).optional(),
  plan_usage: z.enum(["granted", "declined"]).optional(),
  tokens: storedTokensSchema.optional(),
});

export const tokenResponseSchema = z.object({
  access_token: text,
  refresh_token: text.optional(),
  id_token: text.optional(),
  token_type: z.string().max(64).optional(),
  expires_in: z.number().positive().optional(),
  scope: z.string().max(4096).optional(),
  earliest_refresh_at: z.union([z.number(), z.string()]).optional(),
});

export const oauthErrorSchema = z.object({
  error: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/u),
});

export const discoverySchema = z.object({
  issuer: z.string().max(512),
  jwks_uri: z.string().max(2048),
  revocation_endpoint: z.string().max(2048).optional(),
});

export const jwksSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.string(),
      kid: z.string().optional(),
      alg: z.string().optional(),
      n: z.string().optional(),
      e: z.string().optional(),
      crv: z.string().optional(),
      x: z.string().optional(),
      y: z.string().optional(),
    }),
  ),
});

export const jwtHeaderSchema = z.object({ alg: z.string(), kid: z.string().optional() });

export const idTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
  sub: z.string().min(1),
  nonce: z.string().optional(),
  email: z.string().optional(),
});
