#!/usr/bin/env npx tsx
/**
 * notion-sync.ts — HOST-SIDE Notion ↔ Supabase sync daemon for Kjell Inge
 *
 * Two-pass sync on each run:
 *   Outbound: Supabase items (new or updated) → Notion pages
 *   Inbound:  New Notion pages (no Supabase ID) → Supabase + SQLite injection
 *
 * Also propagates Status changes made in Notion back to Supabase.
 *
 * Runs as a host-side systemd timer (every 2 minutes).
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
const NOTION_API_KEY = process.env.NOTION_API_KEY ?? '';
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID ?? '';
const NOTION_SETUP_AFTER = process.env.NOTION_SETUP_AFTER ?? '1970-01-01T00:00:00.000Z';

const NOTION_API = 'https://api.notion.com/v1';
const CALL_DELAY_MS = 400;
const OUTBOUND_BATCH = 20;

const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const NOTION_LOG = path.join(LOG_DIR, 'notion-errors.log');
const LAST_SYNC_FILE = path.join(LOG_DIR, 'notion-sync-last.txt');

function getLastSyncTime(): string {
  try { return fs.readFileSync(LAST_SYNC_FILE, 'utf8').trim(); } catch { return '1970-01-01T00:00:00.000Z'; }
}
function saveLastSyncTime(ts: string): void {
  fs.writeFileSync(LAST_SYNC_FILE, ts);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[notion-sync] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}
if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
  console.error('[notion-sync] NOTION_API_KEY and NOTION_DATABASE_ID must be set');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logErr(msg: string): void {
  const line = `[notion-error] ${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(NOTION_LOG, line);
  console.error(line.trim());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function supabaseGet(path: string): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status}`);
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

async function supabasePost(table: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase POST ${table} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function notionPost(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  await delay(CALL_DELAY_MS);
  const res = await fetch(`${NOTION_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion POST ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function notionPatch(pageId: string, body: Record<string, unknown>): Promise<unknown> {
  await delay(CALL_DELAY_MS);
  const res = await fetch(`${NOTION_API}/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion PATCH pages/${pageId} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Notion page builder
// ---------------------------------------------------------------------------

function buildNotionProperties(item: SupabaseItem): Record<string, unknown> {
  const name = item.content.slice(0, 100);
  const tagsOptions = (item.tags ?? []).map((t: string) => ({ name: t }));
  const props: Record<string, unknown> = {
    Navn: { title: [{ text: { content: name } }] },
    'Full Content': { rich_text: [{ text: { content: item.content } }] },
    Type: { select: { name: item.type } },
    Status: { select: { name: item.status } },
    Tags: { multi_select: tagsOptions },
    Source: { select: { name: item.source } },
    'Supabase ID': { rich_text: [{ text: { content: item.id } }] },
    'Synced At': { date: { start: new Date().toISOString() } },
  };
  if (item.captured_at) {
    props['Captured At'] = { date: { start: item.captured_at } };
  }
  return props;
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
  notion_id: string | null;
  captured_at: string | null;
  last_synced_at: string | null;
  updated_at: string;
}

interface NotionPage {
  id: string;
  created_time: string;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Outbound: Supabase → Notion
// ---------------------------------------------------------------------------

async function outboundSync(newlyInsertedIds: Set<string>): Promise<void> {
  console.log('[notion-sync] Outbound pass...');

  // Items never synced to Notion, plus items updated since last sync run
  const lastSync = getLastSyncTime();
  const [unsyncedItems, updatedItems] = await Promise.all([
    supabaseGet(`items?notion_id=is.null&limit=${OUTBOUND_BATCH}&order=created_at.asc`) as Promise<SupabaseItem[]>,
    supabaseGet(`items?notion_id=not.is.null&updated_at=gt.${encodeURIComponent(lastSync)}&limit=${OUTBOUND_BATCH}&order=updated_at.asc`) as Promise<SupabaseItem[]>,
  ]);
  const seen = new Set<string>();
  const items: SupabaseItem[] = [];
  for (const item of [...unsyncedItems, ...updatedItems]) {
    if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.log('[notion-sync] Outbound: nothing to sync');
    return;
  }

  for (const item of items) {
    // Skip items we just inserted from Notion this tick (loop prevention)
    if (newlyInsertedIds.has(item.id)) continue;

    try {
      const properties = buildNotionProperties(item);

      let pageId: string;

      if (item.notion_id) {
        // Update existing page
        const result = (await notionPatch(item.notion_id, { properties })) as NotionPage;
        pageId = result.id;
        console.log(`[notion-sync] Updated Notion page ${pageId} for Supabase item ${item.id}`);
      } else {
        // Create new page
        const result = (await notionPost('pages', {
          parent: { database_id: NOTION_DATABASE_ID },
          properties,
        })) as NotionPage;
        pageId = result.id;

        // Write Notion page ID back to Supabase
        await supabasePatch('items', `id=eq.${item.id}`, {
          notion_id: pageId,
          last_synced_at: new Date().toISOString(),
        });
        console.log(`[notion-sync] Created Notion page ${pageId} for Supabase item ${item.id}`);
      }

      // Update last_synced_at
      await supabasePatch('items', `id=eq.${item.id}`, {
        last_synced_at: new Date().toISOString(),
      });
    } catch (err) {
      logErr(`outboundSync item ${item.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Inbound: Notion → Supabase + SQLite injection
// ---------------------------------------------------------------------------

function getRegisteredGroupJid(): { jid: string; folder: string } | null {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db
      .prepare("SELECT jid, folder FROM registered_groups WHERE jid LIKE 'dc:%' LIMIT 1")
      .get() as { jid: string; folder: string } | null;
  } finally {
    db.close();
  }
}

function injectToSQLite(content: string, chatJid: string): void {
  const db = new Database(DB_PATH);
  try {
    db.prepare(`
      INSERT OR IGNORE INTO chats (jid, name, last_message_time, channel, is_group)
      VALUES (?, 'Second Brain', datetime('now'), 'discord', 0)
    `).run(chatJid);

    const id = randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO messages
        (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
      VALUES (?, ?, 'notion-inbound', 'Notion', ?, datetime('now'), 0, 0)
    `).run(id, chatJid, content);
  } finally {
    db.close();
  }
}

async function inboundSync(newlyInsertedIds: Set<string>): Promise<void> {
  console.log('[notion-sync] Inbound pass...');

  const group = getRegisteredGroupJid();
  if (!group) {
    console.warn('[notion-sync] No Discord group registered — skipping inbound sync');
    return;
  }

  // Query Notion for pages where Supabase ID is empty AND created after setup
  const result = (await notionPost(`databases/${NOTION_DATABASE_ID}/query`, {
    filter: {
      and: [
        { property: 'Supabase ID', rich_text: { is_empty: true } },
        { timestamp: 'created_time', created_time: { after: NOTION_SETUP_AFTER } },
      ],
    },
    page_size: 20,
  })) as { results: NotionPage[] };

  if (!result.results || result.results.length === 0) {
    console.log('[notion-sync] Inbound: no new Notion pages');
    return;
  }

  for (const page of result.results) {
    const props = page.properties as Record<string, Record<string, unknown>>;

    const fullContent =
      ((props['Full Content']?.rich_text as Array<{ plain_text: string }>)?.[0]?.plain_text) ??
      ((props['Navn']?.title as Array<{ plain_text: string }>)?.[0]?.plain_text) ??
      '';

    if (!fullContent.trim()) {
      console.log(`[notion-sync] Skipping empty Notion page ${page.id}`);
      continue;
    }

    const type = (props['Type']?.select as { name: string } | null)?.name ?? 'note';
    const status = (props['Status']?.select as { name: string } | null)?.name ?? 'open';
    const capturedAt =
      (props['Captured At']?.date as { start: string } | null)?.start ?? page.created_time;

    try {
      // Insert into Supabase
      const rows = (await supabasePost('items', {
        content: fullContent,
        type,
        status,
        source: 'notion',
        notion_id: page.id,
        captured_at: capturedAt,
        last_synced_at: new Date().toISOString(),
      })) as SupabaseItem[];

      const newItem = Array.isArray(rows) ? rows[0] : null;
      if (!newItem?.id) {
        logErr(`inboundSync: failed to insert Notion page ${page.id} into Supabase`);
        continue;
      }

      newlyInsertedIds.add(newItem.id);

      // Write Supabase UUID back to Notion page
      await notionPatch(page.id, {
        properties: {
          'Supabase ID': { rich_text: [{ text: { content: newItem.id } }] },
          'Synced At': { date: { start: new Date().toISOString() } },
        },
      });

      // Inject into SQLite to trigger agent processing
      injectToSQLite(fullContent, group.jid);

      console.log(`[notion-sync] Inbound: Notion ${page.id} → Supabase ${newItem.id}`);
    } catch (err) {
      logErr(`inboundSync page ${page.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Status back-sync: Notion status changes → Supabase
// ---------------------------------------------------------------------------

async function statusBackSync(): Promise<void> {
  // Query Notion for pages that have a Supabase ID (i.e. we track them)
  // and check if their Status differs from Supabase
  const result = (await notionPost(`databases/${NOTION_DATABASE_ID}/query`, {
    filter: {
      property: 'Supabase ID',
      rich_text: { is_not_empty: true },
    },
    page_size: 50,
  })) as { results: NotionPage[] };

  if (!result.results?.length) return;

  for (const page of result.results) {
    const props = page.properties as Record<string, Record<string, unknown>>;
    const supabaseId = ((props['Supabase ID']?.rich_text as Array<{ plain_text: string }>)?.[0]
      ?.plain_text) ?? '';
    const notionStatus = (props['Status']?.select as { name: string } | null)?.name;

    if (!supabaseId || !notionStatus) continue;

    try {
      const rows = (await supabaseGet(`items?id=eq.${supabaseId}&select=id,status`)) as Array<{
        id: string;
        status: string;
      }>;
      const item = rows?.[0];
      if (!item) continue;

      if (item.status !== notionStatus && ['open', 'done', 'archived'].includes(notionStatus)) {
        await supabasePatch('items', `id=eq.${supabaseId}`, { status: notionStatus });
        console.log(`[notion-sync] Status back-sync: ${supabaseId} → ${notionStatus}`);
      }
    } catch (err) {
      logErr(`statusBackSync item ${supabaseId}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`[notion-sync] Starting sync run at ${new Date().toISOString()}`);

  // Track IDs inserted from Notion this tick to prevent outbound loop
  const newlyInsertedIds = new Set<string>();

  try {
    await outboundSync(newlyInsertedIds);
  } catch (err) {
    logErr(`outboundSync failed: ${err}`);
  }

  try {
    await inboundSync(newlyInsertedIds);
  } catch (err) {
    logErr(`inboundSync failed: ${err}`);
  }

  try {
    await statusBackSync();
  } catch (err) {
    logErr(`statusBackSync failed: ${err}`);
  }

  const completedAt = new Date().toISOString();
  saveLastSyncTime(completedAt);
  console.log(`[notion-sync] Sync run complete at ${completedAt}`);
}

main().catch(err => {
  logErr(`main: ${err}`);
  process.exit(1);
});
