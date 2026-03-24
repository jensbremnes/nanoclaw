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
// Optional: PARA hub root page ID. If unset, hub sync is skipped.
const NOTION_HUB_PAGE_ID = process.env.NOTION_HUB_PAGE_ID ?? '';

const NOTION_API = 'https://api.notion.com/v1';
const CALL_DELAY_MS = 400;
const OUTBOUND_BATCH = 20;

const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const NOTION_LOG = path.join(LOG_DIR, 'notion-errors.log');
const LAST_SYNC_FILE = path.join(LOG_DIR, 'notion-sync-last.txt');
const HUB_STATE_FILE = path.join(LOG_DIR, 'notion-hub-state.json');

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

async function notionGet(endpoint: string): Promise<unknown> {
  await delay(CALL_DELAY_MS);
  const res = await fetch(`${NOTION_API}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion GET ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function notionDelete(blockId: string): Promise<void> {
  await delay(CALL_DELAY_MS);
  const res = await fetch(`${NOTION_API}/blocks/${blockId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion DELETE block ${blockId} → ${res.status}: ${text}`);
  }
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
  // PARA upgrade fields (nullable — may be absent on older rows)
  elaboration: string | null;
  elaboration_generated_at: string | null;
  elaboration_synced_at: string | null;
  notion_hub_page_id: string | null;
  related_item_ids: string[] | null;
  project_id: string | null;
}

interface SupabaseProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  para_category: string;
  goal_id: string | null;
  notion_id: string | null;
  tags: string[];
  updated_at: string;
}

interface SupabaseGoal {
  id: string;
  name: string;
  description: string | null;
  status: string;
  target_date: string | null;
  notion_id: string | null;
  updated_at: string;
}

interface SupabaseWeeklyDigest {
  id: string;
  week_start: string;
  content: string;
  notion_id: string | null;
}

interface HubState {
  projects_db_id: string;
  goals_db_id: string;
  resources_db_id: string;
  reflections_db_id: string;
  tasks_db_id: string;
  archive_db_id: string;
  digests_page_id: string;
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
  const fields = 'id,content,type,status,tags,source,notion_id,captured_at,last_synced_at,updated_at,elaboration,elaboration_generated_at,elaboration_synced_at,notion_hub_page_id,related_item_ids,project_id';
  const [unsyncedItems, updatedItems] = await Promise.all([
    supabaseGet(`items?notion_id=is.null&limit=${OUTBOUND_BATCH}&order=created_at.asc&select=${fields}`) as Promise<SupabaseItem[]>,
    supabaseGet(`items?notion_id=not.is.null&updated_at=gt.${encodeURIComponent(lastSync)}&limit=${OUTBOUND_BATCH}&order=updated_at.asc&select=${fields}`) as Promise<SupabaseItem[]>,
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
      const rows = (await supabaseGet(`items?id=eq.${supabaseId}&select=id,status,updated_at,last_synced_at`)) as Array<{
        id: string;
        status: string;
        updated_at: string;
        last_synced_at: string | null;
      }>;
      const item = rows?.[0];
      if (!item) continue;

      // Don't overwrite a Supabase change that hasn't been pushed to Notion yet
      if (item.last_synced_at && item.updated_at > item.last_synced_at) continue;

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
// PARA Hub: state file helpers
// ---------------------------------------------------------------------------

function loadHubState(): Partial<HubState> {
  try {
    return JSON.parse(fs.readFileSync(HUB_STATE_FILE, 'utf8')) as Partial<HubState>;
  } catch {
    return {};
  }
}

function saveHubState(state: Partial<HubState>): void {
  fs.writeFileSync(HUB_STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// PARA Hub: ensure structure exists in Notion
// ---------------------------------------------------------------------------

async function createNotionDatabase(
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>
): Promise<string> {
  const result = (await notionPost('databases', {
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    properties,
  })) as { id: string };
  return result.id;
}

async function createNotionPage(parentPageId: string, title: string): Promise<string> {
  const result = (await notionPost('pages', {
    parent: { type: 'page_id', page_id: parentPageId },
    properties: {
      title: { title: [{ type: 'text', text: { content: title } }] },
    },
  })) as { id: string };
  return result.id;
}

const BASE_DB_PROPERTIES = {
  Name: { title: {} },
  Status: { select: { options: [{ name: 'open' }, { name: 'done' }, { name: 'archived' }] } },
  Tags: { multi_select: {} },
  'Supabase ID': { rich_text: {} },
  'Captured At': { date: {} },
  Source: { select: { options: [{ name: 'discord' }, { name: 'voice' }, { name: 'notion' }] } },
};

async function ensureHubStructure(): Promise<HubState | null> {
  if (!NOTION_HUB_PAGE_ID) return null;

  const state = loadHubState();

  // Check all required IDs present
  const required: (keyof HubState)[] = [
    'projects_db_id', 'goals_db_id', 'resources_db_id',
    'reflections_db_id', 'tasks_db_id', 'archive_db_id', 'digests_page_id',
  ];
  if (required.every(k => !!state[k])) {
    return state as HubState;
  }

  console.log('[notion-sync] Bootstrapping PARA hub structure...');

  try {
    if (!state.projects_db_id) {
      state.projects_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '🗂 Projects', {
        Name: { title: {} },
        Status: { select: { options: [{ name: 'active' }, { name: 'on_hold' }, { name: 'completed' }, { name: 'archived' }] } },
        'Para Category': { select: { options: [{ name: 'projects' }, { name: 'areas' }, { name: 'resources' }] } },
        Tags: { multi_select: {} },
        Description: { rich_text: {} },
        'Supabase ID': { rich_text: {} },
      });
      console.log(`[notion-sync] Created Projects DB: ${state.projects_db_id}`);
      saveHubState(state);
    }

    if (!state.goals_db_id) {
      state.goals_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '🎯 Goals', {
        Name: { title: {} },
        Status: { select: { options: [{ name: 'active' }, { name: 'completed' }, { name: 'archived' }] } },
        'Target Date': { date: {} },
        Description: { rich_text: {} },
        'Supabase ID': { rich_text: {} },
      });
      console.log(`[notion-sync] Created Goals DB: ${state.goals_db_id}`);
      saveHubState(state);
    }

    if (!state.tasks_db_id) {
      state.tasks_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '📋 Tasks', BASE_DB_PROPERTIES);
      console.log(`[notion-sync] Created Tasks DB: ${state.tasks_db_id}`);
      saveHubState(state);
    }

    if (!state.resources_db_id) {
      state.resources_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '📚 Resources', {
        ...BASE_DB_PROPERTIES,
        Type: { select: { options: [{ name: 'idea' }, { name: 'note' }] } },
      });
      console.log(`[notion-sync] Created Resources DB: ${state.resources_db_id}`);
      saveHubState(state);
    }

    if (!state.reflections_db_id) {
      state.reflections_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '🪞 Reflections', BASE_DB_PROPERTIES);
      console.log(`[notion-sync] Created Reflections DB: ${state.reflections_db_id}`);
      saveHubState(state);
    }

    if (!state.archive_db_id) {
      state.archive_db_id = await createNotionDatabase(NOTION_HUB_PAGE_ID, '📦 Archive', {
        ...BASE_DB_PROPERTIES,
        Type: { select: { options: [{ name: 'task' }, { name: 'idea' }, { name: 'note' }, { name: 'reflection' }] } },
      });
      console.log(`[notion-sync] Created Archive DB: ${state.archive_db_id}`);
      saveHubState(state);
    }

    if (!state.digests_page_id) {
      state.digests_page_id = await createNotionPage(NOTION_HUB_PAGE_ID, '📅 Weekly Digests');
      console.log(`[notion-sync] Created Weekly Digests page: ${state.digests_page_id}`);
      saveHubState(state);
    }

    console.log('[notion-sync] PARA hub structure ready');
    return state as HubState;
  } catch (err) {
    logErr(`ensureHubStructure: ${err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PARA Hub: item page body blocks
// ---------------------------------------------------------------------------

function buildHubBlocks(item: SupabaseItem): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [
    {
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Original Capture' } }] },
    },
    {
      type: 'quote',
      quote: { rich_text: [{ type: 'text', text: { content: item.content.slice(0, 2000) } }] },
    },
    { type: 'divider', divider: {} },
  ];

  if (item.elaboration) {
    blocks.push({
      type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: 'Elaboration' } }] },
    });

    // Split elaboration into sections by ## headings; write each as its own block
    const sections = item.elaboration.split(/^##\s+/m).filter(Boolean);
    for (const section of sections) {
      const lines = section.split('\n').filter(Boolean);
      const heading = lines[0];
      const body = lines.slice(1).join('\n').trim();

      if (heading && body) {
        blocks.push({
          type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: heading.trim() } }] },
        });

        // Bullet list items start with "- "
        const bulletLines = body.split('\n').filter(l => l.trim().startsWith('-'));
        const paraLines = body.split('\n').filter(l => !l.trim().startsWith('-') && l.trim());

        for (const para of paraLines) {
          if (para.trim()) {
            blocks.push({
              type: 'paragraph',
              paragraph: { rich_text: [{ type: 'text', text: { content: para.trim().slice(0, 2000) } }] },
            });
          }
        }
        for (const bullet of bulletLines) {
          blocks.push({
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: bullet.replace(/^-\s*/, '').slice(0, 2000) } }],
            },
          });
        }
      }
    }
    blocks.push({ type: 'divider', divider: {} });
  }

  blocks.push({
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Metadata' } }] },
  });
  blocks.push({
    type: 'paragraph',
    paragraph: {
      rich_text: [{
        type: 'text',
        text: {
          content: `Type: ${item.type} | Source: ${item.source} | Captured: ${item.captured_at ?? 'unknown'}`,
        },
      }],
    },
  });

  // Notion API blocks endpoint accepts max 100 children per request
  return blocks.slice(0, 100);
}

// ---------------------------------------------------------------------------
// PARA Hub: sync a single item to the hub
// ---------------------------------------------------------------------------

function getHubDatabaseId(item: SupabaseItem, hub: HubState): string {
  if (item.status === 'archived') return hub.archive_db_id;
  if (item.type === 'task') return hub.tasks_db_id;
  if (item.type === 'reflection') return hub.reflections_db_id;
  return hub.resources_db_id; // idea, note
}

function buildHubProperties(item: SupabaseItem): Record<string, unknown> {
  const name = item.content.slice(0, 100);
  const tagsOptions = (item.tags ?? []).map((t: string) => ({ name: t }));
  const props: Record<string, unknown> = {
    Name: { title: [{ text: { content: name } }] },
    Status: { select: { name: item.status } },
    Tags: { multi_select: tagsOptions },
    Source: { select: { name: item.source } },
    'Supabase ID': { rich_text: [{ text: { content: item.id } }] },
  };
  if (item.captured_at) {
    props['Captured At'] = { date: { start: item.captured_at } };
  }
  if (item.type === 'idea' || item.type === 'note') {
    props['Type'] = { select: { name: item.type } };
  }
  return props;
}

async function appendBlocks(pageId: string, blocks: Record<string, unknown>[]): Promise<void> {
  await notionPost(`blocks/${pageId}/children`, { children: blocks });
}

async function clearElaborationBlocks(pageId: string): Promise<void> {
  const result = (await notionGet(`blocks/${pageId}/children`)) as {
    results: Array<{ id: string; type: string; heading_2?: { rich_text: Array<{ plain_text: string }> } }>;
  };
  if (!result?.results) return;

  // Delete from the first "Elaboration" heading onward (but keep "Original Capture" and "Metadata")
  let inElaboration = false;
  for (const block of result.results) {
    const headingText = block.heading_2?.rich_text?.[0]?.plain_text ?? '';
    if (headingText === 'Elaboration') inElaboration = true;
    if (inElaboration) {
      try { await notionDelete(block.id); } catch { /* best-effort */ }
    }
  }
}

async function syncItemToHub(item: SupabaseItem, hub: HubState): Promise<void> {
  const dbId = getHubDatabaseId(item, hub);

  if (!item.notion_hub_page_id) {
    // Create new hub page
    const result = (await notionPost('pages', {
      parent: { database_id: dbId },
      properties: buildHubProperties(item),
      children: buildHubBlocks(item),
    })) as { id: string };

    await supabasePatch('items', `id=eq.${item.id}`, {
      notion_hub_page_id: result.id,
      elaboration_synced_at: new Date().toISOString(),
    });

    console.log(`[notion-sync] Hub: created page ${result.id} for item ${item.id}`);
    return;
  }

  // Update hub page if elaboration is newer than last sync
  const needsElabUpdate =
    item.elaboration_generated_at &&
    (!item.elaboration_synced_at || item.elaboration_generated_at > item.elaboration_synced_at);

  if (needsElabUpdate) {
    // Clear old elaboration blocks and re-append fresh ones
    try {
      await clearElaborationBlocks(item.notion_hub_page_id);
      await appendBlocks(item.notion_hub_page_id, buildHubBlocks(item));
      await supabasePatch('items', `id=eq.${item.id}`, {
        elaboration_synced_at: new Date().toISOString(),
      });
      console.log(`[notion-sync] Hub: updated elaboration for item ${item.id}`);
    } catch (err) {
      logErr(`syncItemToHub update blocks ${item.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PARA Hub: sync projects
// ---------------------------------------------------------------------------

async function syncProjects(hub: HubState): Promise<void> {
  let projects: SupabaseProject[];
  try {
    projects = (await supabaseGet(
      `projects?order=created_at.asc&limit=50&select=id,name,description,status,para_category,notion_id,tags,updated_at`
    )) as SupabaseProject[];
  } catch (err) {
    logErr(`syncProjects fetch: ${err}`);
    return;
  }
  if (!Array.isArray(projects) || projects.length === 0) return;

  for (const project of projects) {
    if (project.notion_id) continue; // already synced

    try {
      const result = (await notionPost('pages', {
        parent: { database_id: hub.projects_db_id },
        properties: {
          Name: { title: [{ text: { content: project.name } }] },
          Status: { select: { name: project.status } },
          'Para Category': { select: { name: project.para_category } },
          Tags: { multi_select: (project.tags ?? []).map(t => ({ name: t })) },
          Description: { rich_text: [{ text: { content: project.description ?? '' } }] },
          'Supabase ID': { rich_text: [{ text: { content: project.id } }] },
        },
      })) as { id: string };

      await supabasePatch('projects', `id=eq.${project.id}`, {
        notion_id: result.id,
      });
      console.log(`[notion-sync] Created Project page ${result.id} for ${project.name}`);
    } catch (err) {
      logErr(`syncProjects project ${project.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PARA Hub: sync goals
// ---------------------------------------------------------------------------

async function syncGoals(hub: HubState): Promise<void> {
  let goals: SupabaseGoal[];
  try {
    goals = (await supabaseGet(
      `goals?order=created_at.asc&limit=50&select=id,name,description,status,target_date,notion_id,updated_at`
    )) as SupabaseGoal[];
  } catch (err) {
    logErr(`syncGoals fetch: ${err}`);
    return;
  }
  if (!Array.isArray(goals) || goals.length === 0) return;

  for (const goal of goals) {
    if (goal.notion_id) continue;

    try {
      const props: Record<string, unknown> = {
        Name: { title: [{ text: { content: goal.name } }] },
        Status: { select: { name: goal.status } },
        Description: { rich_text: [{ text: { content: goal.description ?? '' } }] },
        'Supabase ID': { rich_text: [{ text: { content: goal.id } }] },
      };
      if (goal.target_date) {
        props['Target Date'] = { date: { start: goal.target_date } };
      }

      const result = (await notionPost('pages', {
        parent: { database_id: hub.goals_db_id },
        properties: props,
      })) as { id: string };

      await supabasePatch('goals', `id=eq.${goal.id}`, { notion_id: result.id });
      console.log(`[notion-sync] Created Goal page ${result.id} for ${goal.name}`);
    } catch (err) {
      logErr(`syncGoals goal ${goal.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PARA Hub: sync weekly digests to Notion
// ---------------------------------------------------------------------------

async function syncWeeklyDigests(hub: HubState): Promise<void> {
  let digests: SupabaseWeeklyDigest[];
  try {
    digests = (await supabaseGet(
      `weekly_digests?notion_id=is.null&order=week_start.desc&limit=5&select=id,week_start,content,notion_id`
    )) as SupabaseWeeklyDigest[];
  } catch (err) {
    logErr(`syncWeeklyDigests fetch: ${err}`);
    return;
  }
  if (!Array.isArray(digests) || digests.length === 0) return;

  for (const digest of digests) {
    try {
      // Create a child page under the Weekly Digests page
      const result = (await notionPost('pages', {
        parent: { type: 'page_id', page_id: hub.digests_page_id },
        properties: {
          title: { title: [{ type: 'text', text: { content: `Week ${digest.week_start}` } }] },
        },
      })) as { id: string };

      // Write the digest content as paragraph blocks
      // Split by lines and write in batches of 100 blocks max
      const lines = digest.content.split('\n');
      const blocks: Record<string, unknown>[] = [];

      for (const line of lines) {
        if (line.startsWith('# ')) {
          blocks.push({
            type: 'heading_1',
            heading_1: { rich_text: [{ type: 'text', text: { content: line.replace(/^# /, '') } }] },
          });
        } else if (line.startsWith('## ')) {
          blocks.push({
            type: 'heading_2',
            heading_2: { rich_text: [{ type: 'text', text: { content: line.replace(/^## /, '') } }] },
          });
        } else if (line.startsWith('- ')) {
          blocks.push({
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^- /, '') } }] },
          });
        } else if (line.trim()) {
          blocks.push({
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }] },
          });
        }
      }

      if (blocks.length > 0) {
        await appendBlocks(result.id, blocks.slice(0, 100));
      }

      await supabasePatch('weekly_digests', `id=eq.${digest.id}`, {
        notion_id: result.id,
        last_synced_at: new Date().toISOString(),
      });
      console.log(`[notion-sync] Created digest page ${result.id} for week ${digest.week_start}`);
    } catch (err) {
      logErr(`syncWeeklyDigests digest ${digest.id}: ${err}`);
    }
  }
}

// ---------------------------------------------------------------------------
// PARA Hub: sync all items that need hub pages
// ---------------------------------------------------------------------------

async function hubItemSync(hub: HubState): Promise<void> {
  // Items with no hub page yet
  const unsynced = (await supabaseGet(
    `items?notion_hub_page_id=is.null&status=neq.archived&order=created_at.asc&limit=20&select=id,content,type,status,tags,source,captured_at,elaboration,elaboration_generated_at,elaboration_synced_at,notion_hub_page_id,related_item_ids,project_id`
  )) as SupabaseItem[];

  // Items where elaboration was updated after last hub sync
  const needsUpdate = (await supabaseGet(
    `items?notion_hub_page_id=not.is.null&elaboration_generated_at=not.is.null&order=elaboration_generated_at.desc&limit=10&select=id,content,type,status,tags,source,captured_at,elaboration,elaboration_generated_at,elaboration_synced_at,notion_hub_page_id,related_item_ids,project_id`
  )) as SupabaseItem[];

  // Combine, deduplicate
  const seen = new Set<string>();
  const items: SupabaseItem[] = [];
  for (const item of [...(unsynced ?? []), ...(needsUpdate ?? [])]) {
    // Only include needsUpdate items that actually need updating
    if (item.notion_hub_page_id && item.elaboration_generated_at && item.elaboration_synced_at &&
        item.elaboration_generated_at <= item.elaboration_synced_at) continue;
    if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
  }

  if (items.length === 0) {
    console.log('[notion-sync] Hub items: nothing to sync');
    return;
  }

  console.log(`[notion-sync] Hub items: syncing ${items.length} item(s)`);

  for (const item of items) {
    try {
      await syncItemToHub(item, hub);
      await delay(CALL_DELAY_MS);
    } catch (err) {
      logErr(`hubItemSync item ${item.id}: ${err}`);
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

  // PARA hub sync (only if NOTION_HUB_PAGE_ID is configured)
  if (NOTION_HUB_PAGE_ID) {
    let hub: HubState | null = null;
    try {
      hub = await ensureHubStructure();
    } catch (err) {
      logErr(`ensureHubStructure failed: ${err}`);
    }

    if (hub) {
      try { await syncProjects(hub); } catch (err) { logErr(`syncProjects failed: ${err}`); }
      try { await syncGoals(hub); } catch (err) { logErr(`syncGoals failed: ${err}`); }
      try { await hubItemSync(hub); } catch (err) { logErr(`hubItemSync failed: ${err}`); }
      try { await syncWeeklyDigests(hub); } catch (err) { logErr(`syncWeeklyDigests failed: ${err}`); }
    }
  }

  const completedAt = new Date().toISOString();
  saveLastSyncTime(completedAt);
  console.log(`[notion-sync] Sync run complete at ${completedAt}`);
}

main().catch(err => {
  logErr(`main: ${err}`);
  process.exit(1);
});
