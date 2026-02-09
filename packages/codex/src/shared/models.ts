import { CODEX_DEFAULT_MODEL, CODEX_SUPPORTED_MODELS } from '@codex-proxy/provider-core'

export interface ModelInfo {
  id: string
  name: string
  type: 'model'
}

export const SUPPORTED_MODELS: ModelInfo[] = CODEX_SUPPORTED_MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  type: 'model',
}))

export const DEFAULT_MODEL = CODEX_DEFAULT_MODEL

const supportedModelIds = new Set(SUPPORTED_MODELS.map((model) => model.id))

export function resolveModel(requestedModel: string, fallbackModel: string = DEFAULT_MODEL): string {
  if (supportedModelIds.has(requestedModel)) {
    return requestedModel
  }

  if (supportedModelIds.has(fallbackModel)) {
    return fallbackModel
  }

  return DEFAULT_MODEL
}
