---
on:
  schedule:
    - cron: "0 3 * * *"
  workflow_dispatch:

permissions:
  contents: read
  issues: read
  pull-requests: read

engine: claude

tools:
  github:
    toolsets: [default]
  edit:
  bash: ["npm ci", "npm run test:unit", "npm run test:songs"]

mcp-servers:
  langfuse:
    url: "https://doremi-langfuse-mcp.OWNER.workers.dev/mcp"
    headers:
      Authorization: "Bearer ${{ secrets.LANGFUSE_MCP_TOKEN }}"
    allowed: ["list_failed_traces", "get_trace", "get_weekly_cost"]

network:
  allowed:
    - defaults
    - node
    - "doremi-langfuse-mcp.OWNER.workers.dev"

safe-outputs:
  create-pull-request:
    title-prefix: "[nightly] "
    labels: [agent, nightly]
    protected-files: fallback-to-issue
  create-issue:
    title-prefix: "[nightly] "
    labels: [agent, nightly]
    max: 3
    deduplicate-by-title: true

timeout-minutes: 20
---

# Nightly self-review

You review yesterday's failures of the Doremi app while the owner sleeps.

1. Call `list_failed_traces` for the last 24 hours and `get_weekly_cost`.
2. Group failures by cause. Ignore causes with a single occurrence.
3. For each cause, decide one of:
   - A code fix you can prove with `npm run test:unit` and `npm run test:songs`. Open one pull request.
   - Anything else. Open an issue with the trace IDs, the cause, and a suggested fix.
4. Before any edit, write `.agent/plans/nightly-<date>.yaml` from `.agent/plans/TEMPLATE.yaml`. The plan is the first commit of the PR.
5. If weekly cost is above €35, open an issue titled "Budget alert" with the cost breakdown. Do not change the budget.

Never edit `recordings/` or `config/budget.yaml`. Never change the model in `config/llm.yaml`; propose it in an issue instead.
At most one pull request per night. If there is nothing to fix, do nothing.
