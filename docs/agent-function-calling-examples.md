# Example Function Calling / Tool Schemas for AI Agents

These are derived from the OpenAPI and MCP tools. You can paste these into your agent's tool configuration (OpenAI format, Anthropic, etc.).

## OpenAI-style Function Calling Examples

```json
[
  {
    "type": "function",
    "function": {
      "name": "get_analytics",
      "description": "Get comprehensive analytics for a site including totals, timeseries, breakdowns, goals, and revenue attribution.",
      "parameters": {
        "type": "object",
        "properties": {
          "site_id": { "type": "string", "description": "The site ID" },
          "period": { "type": "string", "enum": ["today", "7d", "30d", "90d", "all"] },
          "filters": { "type": "object", "additionalProperties": { "type": "string" } }
        },
        "required": ["site_id", "period"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "create_site",
      "description": "Create a new tracked site.",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "domain": { "type": "string" }
        },
        "required": ["name", "domain"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "forget_visitor",
      "description": "Forget all data for a specific visitor for privacy compliance.",
      "parameters": {
        "type": "object",
        "properties": {
          "site_id": { "type": "string" },
          "visitor_id": { "type": "string" }
        },
        "required": ["site_id", "visitor_id"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_report",
      "description": "Run a daily or weekly report, optionally sending it via configured channels and including AI insights.",
      "parameters": {
        "type": "object",
        "properties": {
          "kind": { "type": "string", "enum": ["daily", "weekly"] },
          "send": { "type": "boolean" }
        }
      }
    }
  }
]
```

## Claude / Anthropic Tools Format

Similar structure using "tools" array with input_schema.

## How to use with your agent

1. Provide the base URL of your Nut Analytics instance.
2. Provide auth (site key as Bearer or your dashboard password as Basic).
3. Give the agent the content of `docs/AGENT-API.md` and/or point it to `/api/v1/openapi`.
4. Optionally, register the MCP endpoint `/api/mcp` if your agent supports custom MCP/JSON-RPC tool servers.

The MCP endpoint at `/api/mcp` supports `tools/list` and `tools/call` for dynamic discovery.

## Example MCP call (for advanced agents)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_analytics",
    "arguments": {
      "site_id": "your-site-id",
      "period": "30d"
    }
  }
}
```

Post this to `https://your-railway-url/api/mcp` with proper Authorization header.
