import { createParser, type EventSourceMessage } from 'eventsource-parser'
import type { CodexSSEEvent } from './types.js'

export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<CodexSSEEvent, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const eventQueue: EventSourceMessage[] = []

  const parser = createParser({
    onEvent(event) {
      eventQueue.push(event)
    }
  })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      parser.feed(decoder.decode(value, { stream: true }))

      while (eventQueue.length > 0) {
        const event = eventQueue.shift()!
        if (!event.data) {
          continue
        }

        try {
          yield JSON.parse(event.data) as CodexSSEEvent
        } catch {
          // Ignore invalid JSON events.
        }
      }
    }

    parser.feed(decoder.decode())

    while (eventQueue.length > 0) {
      const event = eventQueue.shift()!
      if (!event.data) {
        continue
      }

      try {
        yield JSON.parse(event.data) as CodexSSEEvent
      } catch {
        // Ignore invalid JSON events.
      }
    }
  } finally {
    reader.releaseLock()
  }
}
