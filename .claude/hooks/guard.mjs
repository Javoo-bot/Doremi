// Claude Code hook. `pre` blocks policy violations (exit 2), `post` and `error` append to the audit log.
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

const mode = process.argv[2];
const event = JSON.parse(readFileSync(0, 'utf8'));
const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
const { tool_name: tool, tool_input: input = {} } = event;

const block = (reason) => {
  process.stderr.write(`Blocked by .claude/hooks/guard.mjs: ${reason}\n`);
  audit({ decision: 'blocked', reason });
  process.exit(2);
};

function audit(extra) {
  const dir = join(root, '.agent', 'audit');
  mkdirSync(dir, { recursive: true });
  const line = {
    ts: new Date().toISOString(),
    mode,
    session: event.session_id,
    agent: event.agent_type ?? 'main',
    tool,
    target: redact(input.file_path ?? input.command ?? input.url),
    run_id: process.env.GITHUB_RUN_ID,
    sha: process.env.GITHUB_SHA,
    ...extra,
  };
  appendFileSync(join(dir, `${line.ts.slice(0, 10)}.jsonl`), JSON.stringify(line) + '\n');
}

// The audit log can end up in a public artifact, so token-shaped strings never reach it.
function redact(s) {
  return s?.replace(/(gh[pousr]_|github_pat_|sk-|pk-lf-|sk-lf-|AKIA|xox[bp]-|AIza)[A-Za-z0-9_\-]{8,}/g, '$1[REDACTED]')
    .replace(/((?:token|key|secret|password|authorization)[=:\s]+(?:bearer\s+)?)\S+/gi, '$1[REDACTED]');
}

// Reads only the `forbidden:` list from agent-policy.yml, so policy and hook cannot drift.
function forbiddenGlobs() {
  const yml = readFileSync(join(root, '.github', 'agent-policy.yml'), 'utf8');
  const section = yml.split(/^forbidden:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
  return [...section.matchAll(/^\s*-\s*"?([^"\n]+)"?\s*$/gm)].map((m) => m[1]);
}

const globToRegex = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

function allowedMcpServers() {
  return Object.keys(JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8')).mcpServers);
}

const DANGEROUS_BASH = [
  [/\bwrangler\s+(deploy|secret|delete)\b/, 'deploys and secrets go through the production environment'],
  [/\bgit\s+push\b.*(--force|-f\b)/, 'force-push'],
  [/\bgit\s+push\b.*\b(main|production)\b/, 'push to a protected branch'],
  [/\bgh\s+pr\s+merge\b/, 'merging is done by the governance workflow'],
  [/\bgit\b.*--no-verify/, 'skipping the gitleaks pre-commit hook'],
  [/\bgh\s+repo\s+edit\b.*--visibility/, 'repo visibility is the owner’s call'],
  [/\bgit\s+add\b.*(\.env(?!\.example\b)|\.dev\.vars|\.pem\b|\.key\b)/, 'staging a secrets file'],
  [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/, 'recursive delete'],
];

if (mode === 'pre') {
  const forbidden = forbiddenGlobs().map(globToRegex);
  const path = input.file_path ?? input.notebook_path;
  if (path) {
    const rel = (isAbsolute(path) ? relative(root, path) : path).replaceAll('\\', '/');
    if (forbidden.some((re) => re.test(rel))) block(`${rel} is forbidden for agents (agent-policy.yml)`);
  }
  if (tool === 'Bash') {
    const cmd = input.command ?? '';
    for (const [re, why] of DANGEROUS_BASH) if (re.test(cmd)) block(why);
    const touchesForbidden = forbiddenGlobs().some((g) => cmd.includes(g.replace(/\*$/, '')));
    if (touchesForbidden && /(\brm\b|\bmv\b|\bcp\b|>|\bsed\s+-i|\btee\b|\btruncate\b)/.test(cmd)) {
      block('shell write to a forbidden path');
    }
  }
  if (tool?.startsWith('mcp__')) {
    const server = tool.split('__')[1];
    if (!allowedMcpServers().includes(server)) block(`MCP server "${server}" is not in .mcp.json`);
  }
  process.exit(0);
}

audit({ decision: mode === 'error' ? 'failed' : 'ok' });
