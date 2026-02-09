/**
 * Lightweight test runner for Codex proxy
 * Tests API endpoints by calling the locally running server
 */

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROXY_URL = 'http://127.0.0.1:4096'

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

function log(color, ...args) {
  console.log(color, ...args, colors.reset)
}

async function checkServer() {
  try {
    const res = await fetch(`${PROXY_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

async function runTest(testName, testFn) {
  log(colors.cyan, `\n📋 Test: ${testName}`)
  log(colors.blue, '─'.repeat(50))

  try {
    const result = await testFn()
    if (result.success) {
      log(colors.green, `✅ PASS: ${result.message || 'Test passed'}`)
      return true
    } else {
      log(colors.red, `❌ FAIL: ${result.message || 'Test failed'}`)
      if (result.details) {
        log(colors.yellow, 'Details:', JSON.stringify(result.details, null, 2))
      }
      return false
    }
  } catch (err) {
    log(colors.red, `💥 ERROR: ${err.message}`)
    if (err.stack) {
      log(colors.yellow, err.stack.split('\n').slice(0, 3).join('\n'))
    }
    return false
  }
}

async function testHealthCheck() {
  const res = await fetch(`${PROXY_URL}/health`)
  const data = await res.json()

  if (data.ok !== true) {
    return { success: false, message: 'Health check returned !ok', details: data }
  }
  return { success: true, message: 'Server is healthy' }
}

async function testAuthStatus() {
  const res = await fetch(`${PROXY_URL}/auth/status`)
  const data = await res.json()

  if (!data.authenticated) {
    return { success: false, message: 'Not authenticated - run curl -X POST http://127.0.0.1:4096/auth/login' }
  }
  if (data.expired) {
    return { success: false, message: 'Auth token expired - re-authenticate' }
  }
  return { success: true, message: 'Authenticated and valid' }
}

async function testToolCall() {
  // This is the minimal request that triggers the tool call error
  const requestBody = {
    model: "gpt-5.2-codex",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Please call the Task tool with description 'test' and prompt 'say hello'"
      }
    ],
    tools: [
      {
        name: "Task",
        description: "Launch a new agent to handle complex, multi-step tasks autonomously.",
        input_schema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "A short (3-5 word) description of the task"
            },
            prompt: {
              type: "string",
              description: "The task for the agent to perform"
            },
            subagent_type: {
              type: "string",
              description: "The type of specialized agent to use"
            }
          },
          required: ["description", "prompt", "subagent_type"]
        }
      }
    ]
  }

  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  const data = await res.json()

  // Check if we got a valid response
  if (!res.ok) {
    return {
      success: false,
      message: `HTTP ${res.status}: ${data.error?.message || data.message || 'Unknown error'}`,
      details: data
    }
  }

  // Check if response has expected structure
  if (!data.id || !data.content) {
    return {
      success: false,
      message: 'Response missing id or content',
      details: data
    }
  }

  // Check if we got a tool_use block
  const toolUse = data.content.find(c => c.type === 'tool_use')
  if (!toolUse) {
    return {
      success: false,
      message: 'No tool_use in response (expected Task tool call)',
      details: data
    }
  }

  // Verify tool_use structure
  if (!toolUse.id || !toolUse.name || !toolUse.input) {
    return {
      success: false,
      message: 'tool_use missing id, name, or input',
      details: { toolUse }
    }
  }

  return {
    success: true,
    message: `Got tool_use: ${toolUse.name} with id ${toolUse.id}`,
    details: { toolUse }
  }
}

async function testToolCallWithPreviousOutput() {
  // This tests the scenario that caused the original error:
  // A function_call with a function_call_output that contains an error message
  const requestBody = {
    model: "gpt-5.2-codex",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Use the Task tool to read a file"
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "fc_test123",
            name: "Task",
            input: {
              description: "Read file",
              prompt: "Read howto.md",
              subagent_type: "general-purpose"
            }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "fc_test123",
            content: "undefined is not an object (evaluating 'T.input_tokens')"
          }
        ]
      },
      {
        role: "user",
        content: "try again"
      }
    ],
    tools: [
      {
        name: "Task",
        description: "Launch a new agent to handle complex, multi-step tasks autonomously.",
        input_schema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "A short (3-5 word) description of the task"
            },
            prompt: {
              type: "string",
              description: "The task for the agent to perform"
            },
            subagent_type: {
              type: "string",
              description: "The type of specialized agent to use"
            }
          },
          required: ["description", "prompt", "subagent_type"]
        }
      }
    ]
  }

  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!res.ok) {
    const data = await res.json()
    return {
      success: false,
      message: `HTTP ${res.status}: ${data.error?.message || 'Request failed'}`,
      details: data
    }
  }

  const data = await res.json()
  return {
    success: true,
    message: 'Tool call with previous output succeeded',
    details: data
  }
}

async function testMultiTurnConversationWithError() {
  // This tests the EXACT scenario from the debug logs:
  // Multiple turns of tool calls with error messages in function_call_output
  const fcId1 = 'fc_' + Math.random().toString(36).substring(2, 15)
  const fcId2 = 'fc_' + Math.random().toString(36).substring(2, 15)

  const requestBody = {
    model: "gpt-5.2-codex",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Read howto.md"
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: fcId1,
            name: "Task",
            input: {
              description: "Read howto.md",
              prompt: "Read the howto.md file and summarize it",
              subagent_type: "general-purpose"
            }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: fcId1,
            content: "undefined is not an object (evaluating 'T.input_tokens')"
          }
        ]
      },
      {
        role: "user",
        content: "try again"
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: fcId2,
            name: "Task",
            input: {
              description: "Read howto.md",
              prompt: "Read the howto.md file and summarize it",
              subagent_type: "general-purpose"
            }
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: fcId2,
            content: "undefined is not an object (evaluating 'T.input_tokens')"
          }
        ]
      },
      {
        role: "user",
        content: "try again"
      }
    ],
    tools: [
      {
        name: "Task",
        description: "Launch a new agent to handle complex, multi-step tasks autonomously.",
        input_schema: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "A short (3-5 word) description of the task"
            },
            prompt: {
              type: "string",
              description: "The task for the agent to perform"
            },
            subagent_type: {
              type: "string",
              description: "The type of specialized agent to use"
            }
          },
          required: ["description", "prompt", "subagent_type"]
        }
      }
    ]
  }

  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!res.ok) {
    const data = await res.json()
    return {
      success: false,
      message: `HTTP ${res.status}: ${data.error?.message || 'Request failed'}`,
      details: data
    }
  }

  const data = await res.json()

  // The key check: does this work or does it error with the same issue?
  if (!data.content) {
    return {
      success: false,
      message: 'Response missing content',
      details: data
    }
  }

  return {
    success: true,
    message: 'Multi-turn conversation with errors succeeded',
    details: data
  }
}

async function testDirectToolCallWithRead() {
  // Test that tools work when directly requested (not via Task sub-agent)
  // This tests the basic tool calling flow
  const requestBody = {
    model: "gpt-5.2-codex",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Read the file howto.md and tell me what it says"
      }
    ],
    tools: [
      {
        name: "Read",
        description: "Reads a file from the filesystem. Use this to read file contents.",
        input_schema: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "The absolute path to the file"
            }
          },
          required: ["file_path"]
        }
      }
    ]
  }

  const res = await fetch(`${PROXY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })

  if (!res.ok) {
    const data = await res.json()
    return {
      success: false,
      message: `HTTP ${res.status}: ${data.error?.message || 'Request failed'}`,
      details: data
    }
  }

  const data = await res.json()

  // Check if we got a tool_use block
  const toolUse = data.content?.find(c => c.type === 'tool_use')
  if (!toolUse) {
    return {
      success: false,
      message: 'No tool_use in response - expected Read tool call',
      details: data
    }
  }

  if (toolUse.name !== 'Read') {
    return {
      success: false,
      message: `Expected Read tool, got ${toolUse.name}`,
      details: { toolUse }
    }
  }

  return {
    success: true,
    message: `Got tool_use: ${toolUse.name} with file_path ${toolUse.input?.file_path || '(missing)'}`,
    details: { toolUse }
  }
}

// Main test runner
async function main() {
  log(colors.magenta, '\n🧪 Codex Proxy Test Runner')
  log(colors.magenta, '='.repeat(50))

  // Check if server is running
  log(colors.cyan, '\n🔍 Checking if server is running...')
  const serverUp = await checkServer()
  if (!serverUp) {
    log(colors.red, '❌ Server not running!')
    log(colors.yellow, 'Start it with: npm run dev')
    process.exit(1)
  }
  log(colors.green, '✅ Server is running')

  // Run tests
  const tests = [
    { name: 'Health Check', fn: testHealthCheck },
    { name: 'Auth Status', fn: testAuthStatus },
    { name: 'Tool Call (Task tool)', fn: testToolCall },
    { name: 'Tool Call with Previous Output', fn: testToolCallWithPreviousOutput },
    { name: 'Multi-turn Conversation with Errors', fn: testMultiTurnConversationWithError },
    { name: 'Direct Tool Call (Read tool)', fn: testDirectToolCallWithRead },
  ]

  let passed = 0
  let failed = 0

  for (const test of tests) {
    const result = await runTest(test.name, test.fn)
    if (result) passed++
    else failed++
  }

  // Summary
  log(colors.magenta, '\n' + '='.repeat(50))
  log(colors.cyan, `📊 Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  log(colors.red, 'Fatal error:', err)
  process.exit(1)
})
