# Agent Notes

## Codex Proxy Auth Token Path

The proxy defaults to `~/.codex-proxy/tokens.json`. In this repo, test runs should use the local token file:

```bash
CODEX_PROXY_TOKEN_FILE=/Users/chrismck/Code/codex_in_claude_code/.tokens.json npm run start
```

For test execution against the running proxy:

```bash
CODEX_PROXY_TOKEN_FILE=/Users/chrismck/Code/codex_in_claude_code/.tokens.json node test.js
```
