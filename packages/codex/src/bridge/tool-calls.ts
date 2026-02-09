import { fromMarkdown } from 'mdast-util-from-markdown'
import { z } from 'zod'
import { generateFunctionCallId } from './id.js'

const TOOL_CALL_SCHEMA = z.object({
  name: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  arguments: z.record(z.string(), z.unknown()).optional()
})

export interface ParsedToolCallFromText {
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolCallBlockRange {
  start: number
  end: number
  value: string
}

interface MarkdownNode {
  type?: string
  lang?: string | null
  value?: string
  children?: MarkdownNode[]
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
}

function isToolCallFenceLanguage(lang: string | null | undefined): boolean {
  if (!lang) {
    return false
  }

  return lang.trim().toLowerCase() === 'tool_call'
}

function collectToolCallBlockRanges(text: string): ToolCallBlockRange[] {
  const tree = fromMarkdown(text) as unknown as MarkdownNode
  const ranges: ToolCallBlockRange[] = []

  const visit = (node: MarkdownNode): void => {
    if (node.type === 'code' && isToolCallFenceLanguage(node.lang)) {
      const start = node.position?.start?.offset
      const end = node.position?.end?.offset

      if (typeof start === 'number' && typeof end === 'number' && start >= 0 && end >= start) {
        ranges.push({
          start,
          end,
          value: typeof node.value === 'string' ? node.value : ''
        })
      }
    }

    for (const child of node.children || []) {
      visit(child)
    }
  }

  visit(tree)
  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

export function stripToolCallBlocks(text: string): string {
  const ranges = collectToolCallBlockRanges(text)
  if (ranges.length === 0) {
    return text.trim()
  }

  const parts: string[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start))
    }
    cursor = Math.max(cursor, range.end)
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return parts.join('').trim()
}

export function parseToolCallsFromText(text: string): ParsedToolCallFromText[] {
  const toolCalls: ParsedToolCallFromText[] = []
  const blocks = collectToolCallBlockRanges(text)

  for (const block of blocks) {
    const rawBlock = block.value.trim()
    if (!rawBlock) {
      continue
    }

    try {
      const maybeToolCall = JSON.parse(rawBlock) as unknown
      const parsed = TOOL_CALL_SCHEMA.safeParse(maybeToolCall)
      if (!parsed.success) {
        continue
      }

      const input = parsed.data.input || parsed.data.arguments || {}
      toolCalls.push({
        id: generateFunctionCallId(),
        name: parsed.data.name,
        input
      })
    } catch {
      // Ignore malformed tool_call blocks.
    }
  }

  return toolCalls
}
