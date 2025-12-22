#!/usr/bin/env node

/**
 * PreToolUse hook: Validates file writes against project conventions.
 * Warns about hardcoded Cyrillic strings in components (should use i18n).
 */

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || data.tool_input?.path || '';
    const content = data.tool_input?.content || data.tool_input?.file_text || '';
    
    // Check for hardcoded Cyrillic strings in components (should use i18n)
    if (filePath.includes('/components/') && content) {
      // Match Cyrillic words (3+ chars) not in comments or console.log
      const lines = content.split('\n');
      const issues = [];
      
      lines.forEach((line, idx) => {
        // Skip comments and console statements
        if (line.trim().startsWith('//') || 
            line.trim().startsWith('*') || 
            line.includes('console.')) {
          return;
        }
        
        // Check for Cyrillic text (likely hardcoded UI strings)
        const cyrillicMatch = line.match(/[а-яА-ЯёЁ]{3,}/g);
        if (cyrillicMatch) {
          issues.push(`Line ${idx + 1}: "${cyrillicMatch.join(', ')}"`);
        }
      });
      
      if (issues.length > 0) {
        process.stderr.write(`
⚠️  HARDCODED CYRILLIC TEXT DETECTED
────────────────────────────────────
File: ${filePath}
${issues.slice(0, 5).join('\n')}
${issues.length > 5 ? `... and ${issues.length - 5} more` : ''}

→ Use i18n: import { useTranslation } from '@/i18n'
→ Then: t('namespace.key') instead of hardcoded text
────────────────────────────────────
`);
      }
    }
    
    // All checks passed (warnings don't block)
    process.exit(0);
  } catch (e) {
    // Don't block on parse errors
    process.exit(0);
  }
});
