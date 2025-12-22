#!/usr/bin/env node

/**
 * PreToolUse hook (Read matcher): Logs skill file reads for metrics.
 * Writes to: .claude/logs/skills.jsonl
 * Only logs reads from .claude/skills/ directory.
 */

const fs = require('fs');
const path = require('path');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const logFile = path.join(projectDir, '.claude', 'logs', 'skills.jsonl');

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
    
    // Get the file path being read
    const filePath = data.tool_input?.file_path || data.tool_input?.path || '';
    
    // Only log if reading from .claude/skills/
    if (filePath.includes('.claude/skills/') || filePath.includes('.claude\\skills\\')) {
      // Extract skill name from path
      // e.g., ".claude/skills/react-components/SKILL.md" -> "react-components"
      const match = filePath.match(/\.claude[\/\\]skills[\/\\]([^\/\\]+)/);
      const skillName = match ? match[1] : 'unknown';
      const fileName = path.basename(filePath);
      
      const entry = {
        ts: new Date().toISOString(),
        skill: skillName,
        file: fileName,
        session: data.session_id || null
      };
      
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
    }
    
  } catch (e) {
    // Silently ignore parse errors for skill reads
    // (don't pollute logs with non-skill read errors)
  }
  
  // Always allow the read to proceed
  process.exit(0);
});
