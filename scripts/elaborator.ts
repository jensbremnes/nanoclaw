#!/usr/bin/env npx tsx
/**
 * elaborator.ts — HOST-SIDE auto-elaboration daemon for Kjell Inge
 *
 * Picks up newly captured items with no elaboration, calls the Claude API
 * to generate a type-specific elaboration, finds related items, and writes
 * results back to Supabase. notion-sync.ts then writes the elaboration to
 * each item's Notion hub page body.
 *
 * Runs as a host-side systemd timer every 5 minutes.
 * Never runs inside a NanoClaw container.
 */

import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = process.env.ELABORATOR_MODEL ?? 'claude-haiku-4-5-20251001';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const BATCH_SIZE = 5;
const CLAUDE_DELAY_MS = 1200;

const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'elaborator.log');

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[elaborator] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('[elaborator] ANTHROPIC_API_KEY must be set');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const line = `[elaborator] ${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

function logErr(msg: string): void {
  const line = `[elaborator-error] ${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.error(line);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function supabaseGet(endpoint: string): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${endpoint} → ${res.status}`);
  return res.json();
}

async function supabasePatch(table: string, filter: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}?${filter} → ${res.status}`);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SupabaseItem {
  id: string;
  content: string;
  type: string;
  status: string;
  tags: string[];
  source: string;
}

// ---------------------------------------------------------------------------
// Claude prompts by item type
// ---------------------------------------------------------------------------

function buildPrompt(item: SupabaseItem): string {
  const content = item.content.trim();

  switch (item.type) {
    case 'task':
      return `You are a second brain assistant helping someone manage their tasks and projects.

The user captured this task: "${content}"

Provide a structured elaboration in this exact format (use the exact markdown headings shown):

## Context
<1-2 sentences of relevant background or why this matters>

## Subtasks
- <concrete subtask 1>
- <concrete subtask 2>
- <concrete subtask 3>

## Next Steps
- <the single most important immediate action>

## Related Concepts
<comma-separated list of 3-5 keywords or topics this task connects to>

Be specific and practical. No filler. If you lack context for subtasks, make reasonable assumptions.`;

    case 'idea':
      return `You are a second brain assistant helping someone develop and connect ideas.

The user captured this idea: "${content}"

Provide a structured elaboration in this exact format (use the exact markdown headings shown):

## Expansion
<2-3 sentences developing and deepening the idea>

## Implications
- <concrete implication, application, or angle 1>
- <concrete implication, application, or angle 2>

## Next Steps
- <the single most useful thing to do with this idea>

## Related Concepts
<comma-separated list of 3-5 keywords or topics this idea connects to>

Be intellectually curious. Surface non-obvious connections. No filler.`;

    case 'reflection':
      return `You are a second brain assistant helping someone understand their inner life.

The user reflected: "${content}"

Provide a structured elaboration in this exact format (use the exact markdown headings shown):

## Validation
<1-2 sentences acknowledging and validating what was expressed, without being sycophantic>

## Pattern
<1 sentence noting if this connects to a broader pattern in human experience or the user's situation>

## Next Steps
- <one optional concrete thing to consider or act on, or leave blank if not applicable>

## Related Concepts
<comma-separated list of 3-5 keywords or themes this reflection touches>

Be honest and grounded. No hollow positivity. No filler.`;

    default: // note
      return `You are a second brain assistant helping someone organise their knowledge.

The user noted: "${content}"

Provide a structured elaboration in this exact format (use the exact markdown headings shown):

## Context
<1-2 sentences adding background or context to this note>

## Cross-References
<1-2 sentences suggesting how this connects to other topics or knowledge areas>

## Related Concepts
<comma-separated list of 3-5 keywords or topics this note connects to>

Be concise and informative. No filler.`;
  }
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callClaude(item: SupabaseItem): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: 'user', content: buildPrompt(item) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = data.content?.find(b => b.type === 'text')?.text ?? '';
  if (!text) throw new Error('Claude returned empty response');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Extract keywords from elaboration
// ---------------------------------------------------------------------------

function extractKeywords(elaboration: string): string[] {
  const match = elaboration.match(/##\s*Related Concepts\s*\n([^\n#]+)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 2 && k.length < 40);
}

// ---------------------------------------------------------------------------
// Find related items
// ---------------------------------------------------------------------------

async function findRelatedItems(item: SupabaseItem, keywords: string[]): Promise<string[]> {
  if (keywords.length === 0) return [];

  const related = new Set<string>();

  // Search by keywords (first 3 to limit API calls)
  for (const kw of keywords.slice(0, 3)) {
    try {
      const encoded = encodeURIComponent(`*${kw}*`);
      const rows = (await supabaseGet(
        `items?content=ilike.${encoded}&id=neq.${item.id}&status=neq.archived&limit=3&select=id`
      )) as Array<{ id: string }>;
      for (const r of rows ?? []) related.add(r.id);
    } catch {
      // best-effort
    }
  }

  // Also match by overlapping tags
  if (item.tags?.length) {
    for (const tag of item.tags.slice(0, 2)) {
      try {
        const rows = (await supabaseGet(
          `items?tags=cs.{${encodeURIComponent(tag)}}&id=neq.${item.id}&status=neq.archived&limit=3&select=id`
        )) as Array<{ id: string }>;
        for (const r of rows ?? []) related.add(r.id);
      } catch {
        // best-effort
      }
    }
  }

  return [...related].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`Starting elaboration run`);

  const items = (await supabaseGet(
    `items?elaboration=is.null&status=neq.archived&order=created_at.asc&limit=${BATCH_SIZE}&select=id,content,type,status,tags,source`
  )) as SupabaseItem[];

  if (!Array.isArray(items) || items.length === 0) {
    log('Nothing to elaborate');
    return;
  }

  log(`Found ${items.length} item(s) to elaborate`);

  for (const item of items) {
    try {
      log(`Elaborating item ${item.id} (${item.type})`);
      const elaboration = await callClaude(item);

      const keywords = extractKeywords(elaboration);
      const relatedIds = await findRelatedItems(item, keywords);

      await supabasePatch('items', `id=eq.${item.id}`, {
        elaboration,
        elaboration_generated_at: new Date().toISOString(),
        related_item_ids: relatedIds,
      });

      log(`Elaborated item ${item.id} — ${relatedIds.length} related item(s) found`);
    } catch (err) {
      logErr(`item ${item.id}: ${err}`);
    }

    await delay(CLAUDE_DELAY_MS);
  }

  log('Elaboration run complete');
}

main().catch(err => {
  logErr(`main: ${err}`);
  process.exit(1);
});
