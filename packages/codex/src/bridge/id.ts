import crypto from 'crypto'

export function generateFunctionCallId(): string {
  return 'fc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24)
}
