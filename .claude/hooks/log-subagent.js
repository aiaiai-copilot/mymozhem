#!/usr/bin/env node

/**
 * SubagentStop hook: Logs subagent invocations for metrics.
 * Writes to: .claude/logs/subagents.jsonl
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const logFile = path.join(projectDir, '.claude', 'logs', 'subagents.jsonl');

// Ensure logs directory exists
const logDir = path.dirname(logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    
    // Extract subagent info from the event data
    const entry = {
      ts: new Date().toISOString(),
      agent: data.subagent_name || data.agent_name || data.tool_input?.subagent_type || 'unknown',
      status: data.error ? 'error' : 'completed',
      session: data.session_id || null
    };
    
    // Append to log file
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    
  } catch (e) {
    // Log parsing errors separately
    const errorEntry = {
      ts: new Date().toISOString(),
      agent: 'unknown',
      status: 'parse_error',
      error: e.message
    };
    fs.appendFileSync(logFile, JSON.stringify(errorEntry) + '\n');
  }
  
  process.exit(0);
});
