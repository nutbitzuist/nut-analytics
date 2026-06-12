# Nut Analytics - Agent Setup Guide for the Human Owner

This guide explains how to give your AI agent (Grok, Claude, etc.) complete control over your Nut Analytics instance with zero ongoing manual work from you after initial setup.

## Step 1: Access Your Live Instance
- URL: https://nut-analytics-production.up.railway.app (or your deployed URL)
- Default login email: email.nutty@gmail.com
- **Immediately rotate the password** after first login:
  1. Use the app or Railway dashboard to set a strong `DASHBOARD_PASSWORD` and preferably `DASHBOARD_PASSWORD_HASH` (generate with `node scripts/generate-password-hash.mjs "your-strong-pass"`).
  2. Redeploy if needed: `railway up`.

## Step 2: Create Scoped Keys for the Agent (Recommended)
- In the dashboard, go to any site's **Settings** page.
- Copy the `nut_sk_...` API key.
- Give this to your agent for site-specific work (safer than full password).

For full global power (manage all sites, reports, etc.), also note your `DASHBOARD_PASSWORD` for Basic auth.

## Step 3: Give the Agent the Complete Manual
1. Copy the entire content of `docs/AGENT_MANUAL.md`.
2. Paste it into your AI agent's context/prompt (or upload the file if supported).
3. Also paste `docs/agent-function-calling-examples.md` for tool schemas.
4. Tell the agent: "Here is the full operating manual for my Nut Analytics instance. Base URL is [your-url]. I will provide credentials when you need to act."

## Step 4: Start Using the Agent
Example first message:
"Here is the complete Nut Analytics Agent Manual and function schemas. Base URL: https://nut-analytics-production.up.railway.app

Here is a site key for my main project: nut_sk_XXXX...

Analyze my traffic from the last 30 days, suggest 3 new goals I should register, and run a weekly report preview."

The agent now has everything it needs to:
- Create/manage sites (global level)
- Pull any analytics or raw data
- Manage goals
- Handle privacy requests
- Trigger reports with AI insights
- Use the MCP endpoint for structured tool use
- And more — all documented in the manual.

## Step 5: Global Settings (New Control Center)
- From the main dashboard, click the new "**Global Settings**" link in the header.
- This page lets you (and your agent via API/UI) manage things at the **global level** across all your sites/projects:
  - Overview of every site with quick stats and direct links to per-site settings.
  - Central runner for daily/weekly reports + AI memos (cross-site).
  - Agent integration hub (links to manuals, instructions for generating keys).
  - Reports configuration guidance (how to set Telegram, Resend, Anthropic env vars in Railway).
  - Quick actions for creating sites or triggering privacy at scale.

This addresses the "no global settings, everything is per-project" issue. Your agent can now operate at both per-site and global levels.

## Security & Best Practices
- Rotate keys/passwords regularly (agent can help via the regenerate endpoint).
- Start with scoped `nut_sk_*` keys. Only give the full password for global admin tasks.
- The agent is instructed to always confirm destructive actions with you.
- All API calls are logged in your Railway logs for auditing.
- Never share the full manual + credentials publicly.

## Making the Agent "Do Everything" Autonomously
- The manuals tell the agent to ask you only for credentials and confirmations.
- It can discover the latest capabilities via `/api/v1/openapi` or the MCP `/api/mcp` endpoint.
- For recurring tasks (e.g., "every Monday run reports and summarize"), give the agent a schedule and the credentials once.

## Files to Give Your Agent
- `docs/AGENT_MANUAL.md` (primary)
- `docs/agent-function-calling-examples.md`
- `docs/AGENT_SETUP_FOR_HUMAN.md` (this file — for context)
- The live OpenAPI: [base]/api/v1/openapi
- The MCP endpoint: [base]/api/mcp

With these, your agent has complete documentation and can manage sites globally, analytics, goals, privacy, reports, and everything else without you lifting a finger after setup.

If you want the agent to perform an action right now, paste the manuals + a credential into this chat (with me, Grok) and describe the task. I will use the real APIs/MCP on your live instance.

## Next Steps After Setup
1. Log in and explore the new **Global Settings** page.
2. Create a site key and test with your agent.
3. Ask the agent to "read the full AGENT_MANUAL.md and confirm it can now manage everything at global and per-site level."
4. Start delegating real work (analysis, goal registration, reports, new site setup for new projects, etc.).

This setup turns your Nut Analytics into a fully agent-operable system. Enjoy! 🥜

(If you redeploy or change the base URL, update the agent with the new one.)