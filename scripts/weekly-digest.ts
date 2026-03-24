#!/usr/bin/env npx tsx
/**
 * weekly-digest.ts — HOST-SIDE weekly AI digest generator for Kjell Inge
 *
 * Generates a narrative digest of the past week's captures, completions,
 * and reflections. Inserts into the weekly_digests table; notion-sync.ts
 * picks it up and creates a Notion page on the next run.
 *
 * Optionally injects a Discord notification when the digest is ready.
 *
 * Runs as a host-side systemd timer, Sundays at 22:00.
 * Never runs inside a NanoClaw container.
 */

import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'store', 'messages.db');

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const MODEL = process.env.ELABORATOR_MODEL ?? 'claude-haiku-4-5-20251001';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'weekly-digest.log');

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[weekly-digest] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('[weekly-digest] ANTHROPIC_API_KEY must be set');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const line = `[weekly-digest] ${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

function logErr(msg: string): void {
  const line = `[weekly-digest-error] ${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.error(line);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function supabasePost(table: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST ${table} → ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** Returns the Monday of the week containing `date` as a YYYY-MM-DD string */
function getMondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().split('T')[0];
}

/** Returns the Sunday of the week starting on `mondayStr` */
function getSundayOf(mondayStr: string): string {
  const d = new Date(mondayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split('T')[0];
}

/** Returns the ISO timestamp for the start of a YYYY-MM-DD day (UTC) */
function dayStart(dateStr: string): string {
  return `${dateStr}T00:00:00.000Z`;
}

/** Returns the ISO timestamp for the end of a YYYY-MM-DD day (UTC, exclusive) */
function dayEnd(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
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
  captured_at: string | null;
}

interface UserMeta {
  observation: string;
  week_start: string;
}

// ---------------------------------------------------------------------------
// Discord notification (optional — silently skipped if no group registered)
// ---------------------------------------------------------------------------

function notifyDiscord(message: string): void {
  try {
    const db = new Database(DB_PATH, { readonly: false });
    try {
      const group = db
        .prepare("SELECT jid FROM registered_groups WHERE jid LIKE 'dc:%' LIMIT 1")
        .get() as { jid: string } | null;
      if (!group) return;

      db.prepare(`
        INSERT OR IGNORE INTO chats (jid, name, last_message_time, channel, is_group)
        VALUES (?, 'Second Brain', datetime('now'), 'discord', 0)
      `).run(group.jid);

      const id = randomBytes(16).toString('hex');
      db.prepare(`
        INSERT INTO messages
          (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
        VALUES (?, ?, 'system', 'System', ?, datetime('now'), 0, 0)
      `).run(id, group.jid, message);

      log(`Discord notification queued for ${group.jid}`);
    } finally {
      db.close();
    }
  } catch (err) {
    log(`Discord notify skipped: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Digest generation
// ---------------------------------------------------------------------------

function buildDigestPrompt(
  weekStart: string,
  weekEnd: string,
  captured: SupabaseItem[],
  completed: SupabaseItem[],
  meta: UserMeta | null
): string {
  const formatItem = (item: SupabaseItem) =>
    `[${item.type}] ${item.content.slice(0, 120)}${item.content.length > 120 ? '...' : ''}`;

  const capturedList = captured.length
    ? captured.map(formatItem).join('\n')
    : '(nothing captured this week)';

  const completedList = completed.length
    ? completed.map(i => `- ${i.content.slice(0, 80)}`).join('\n')
    : '(none)';

  const reflection = meta?.observation || '(no weekly reflection written)';

  return `You are a second brain assistant generating a thoughtful weekly digest.

Week: ${weekStart} to ${weekEnd}

## Captured this week (${captured.length} item${captured.length !== 1 ? 's' : ''}):
${capturedList}

## Completed tasks (${completed.length}):
${completedList}

## User's own reflection:
${reflection}

Generate a weekly digest page in this exact format:

# Weekly Digest: ${weekStart}

## Highlights
<Top 3 most significant or interesting captures this week, with a brief note on why each matters. Be specific.>

## Completed
<Bulleted list of completed tasks. If none, say so honestly.>

## Ideas Worth Pursuing
<The 1-3 ideas captured this week that seem most promising or actionable, and why.>

## Reflection Themes
<Patterns or themes across the reflections captured this week. If few reflections, note that.>

## Patterns & Observations
<Any interesting cross-cutting observations about this week's captures — connections between ideas, recurring topics, energy levels implied by content.>

## Suggested Next Week Focus
<1-2 concrete, specific suggestions based on what was captured this week.>

---

Be honest, specific, and useful. Avoid generic advice. No filler. Keep each section concise.`;
}

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log('Starting weekly digest run');

  const weekStart = getMondayOf(new Date());
  const weekEnd = getSundayOf(weekStart);

  log(`Week: ${weekStart} → ${weekEnd}`);

  // Idempotency check — skip if digest for this week already exists
  const existing = (await supabaseGet(
    `weekly_digests?week_start=eq.${weekStart}&select=id`
  )) as Array<{ id: string }>;

  if (existing?.length > 0) {
    log(`Digest for week ${weekStart} already exists — skipping`);
    return;
  }

  // Fetch items captured this week
  const captured = (await supabaseGet(
    `items?captured_at=gte.${dayStart(weekStart)}&captured_at=lt.${dayEnd(weekEnd)}&order=captured_at.asc&select=id,content,type,status,tags,source,captured_at`
  )) as SupabaseItem[];

  // Fetch items completed this week
  const completed = (await supabaseGet(
    `items?status=eq.done&updated_at=gte.${dayStart(weekStart)}&updated_at=lt.${dayEnd(weekEnd)}&type=eq.task&select=id,content,type,status,tags,source,captured_at`
  )) as SupabaseItem[];

  // Fetch user's own reflection for this week if written
  const metaRows = (await supabaseGet(
    `user_meta?week_start=eq.${weekStart}&select=observation,week_start&limit=1`
  )) as UserMeta[];
  const meta = metaRows?.[0] ?? null;

  log(`Found ${captured?.length ?? 0} captured, ${completed?.length ?? 0} completed`);

  const prompt = buildDigestPrompt(weekStart, weekEnd, captured ?? [], completed ?? [], meta);
  const content = await callClaude(prompt);

  // Insert digest — ON CONFLICT DO NOTHING via the unique constraint on week_start
  await supabasePost('weekly_digests', {
    week_start: weekStart,
    content,
  });

  log(`Digest for week ${weekStart} created (${content.length} chars)`);

  // Notify via Discord
  notifyDiscord(`📅 Weekly digest ready for week ${weekStart}. Check Notion for the full summary.`);

  log('Weekly digest run complete');
}

main().catch(err => {
  logErr(`main: ${err}`);
  process.exit(1);
});
