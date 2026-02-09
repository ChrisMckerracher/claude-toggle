import { z } from 'zod';
import type { CredentialsDocument, ProvidersDocument } from './types.js';
import { CREDENTIALS_VERSION, PROVIDERS_VERSION } from './constants.js';

const providerNameSchema = z.string().min(1);
const credentialsRefSchema = z.string().min(1);
const providerKindSchema = z.enum(['anthropic', 'generic', 'codex']);

const providerCredentialsBaseSchema = z.object({
  anthropic_base_url: z.string(),
  anthropic_key: z.string().optional(),
  extras: z.record(z.string(), z.unknown()),
});

const codexCredentialsSchema = z.object({
  kind: z.literal('codex'),
  value: providerCredentialsBaseSchema.extend({
    extras: z.object({
      refresh_token: z.string(),
      access_token: z.string().optional(),
      expires_at: z.number().optional(),
      expires_in: z.number().optional(),
      account_id: z.string().optional(),
      model: z.string().optional(),
    }),
  }),
});

const genericCredentialsSchema = z.object({
  kind: z.union([z.literal('anthropic'), z.literal('generic')]),
  value: providerCredentialsBaseSchema,
});

export const providerCredentialsSchema = z.union([codexCredentialsSchema, genericCredentialsSchema]);

export const providerSchema = z.object({
  name: providerNameSchema,
  kind: providerKindSchema,
  enabled: z.boolean(),
  credentialsRef: credentialsRefSchema,
});

export const agentProviderMappingSchema = z.object({
  agentType: z.string().min(1),
  provider: providerNameSchema,
  teammateSuffix: z.string().min(1).optional(),
});

export const providersDocumentSchema = z.object({
  version: z.number().int().positive().default(PROVIDERS_VERSION),
  activeProvider: z.string().min(1).nullable(),
  providers: z.array(providerSchema),
  agentTypeMappings: z.array(agentProviderMappingSchema),
  migrationLedger: z.record(z.string(), z.number().int().nonnegative()).default({}),
});

export const credentialsDocumentSchema = z.object({
  version: z.number().int().positive().default(CREDENTIALS_VERSION),
  credentials: z.record(z.string(), providerCredentialsSchema),
});

// Legacy v0/v1 CLI shape for migration-in-place on read.
const legacyProviderSchema = z.object({
  name: z.string(),
  type: z.union([z.literal('direct'), z.literal('codex'), z.literal('generic')]),
  baseUrl: z.string().optional(),
  enabled: z.boolean().default(true),
});

const legacyCategorySchema = z.object({
  name: z.string(),
  provider: z.string(),
});

export const legacyProvidersDocumentSchema = z.object({
  version: z.number().int().positive().optional(),
  providers: z.array(legacyProviderSchema),
  active: z.string(),
  agentCategories: z.array(legacyCategorySchema).default([]),
});

export function parseProvidersDocument(data: unknown): ProvidersDocument {
  return providersDocumentSchema.parse(data);
}

export function parseCredentialsDocument(data: unknown): CredentialsDocument {
  return credentialsDocumentSchema.parse(data);
}
