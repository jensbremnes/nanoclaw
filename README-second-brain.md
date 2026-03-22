# Kjell Inge — Second Brain on NanoClaw

A personal second-brain system built on top of NanoClaw. The agent — **Kjell Inge** — captures thoughts, tasks, ideas, and reflections from three sources and keeps everything organised in Supabase, mirrored to Notion.

## Capture Sources

| Source | How it works |
|--------|-------------|
| **Discord** | Send any message to the bot channel — no @mention needed |
| **Voice memos** | Record on iPhone → syncs via Dropbox → transcribed locally |
| **Notion** | Type directly into the Second Brain database → agent processes it |

## Architecture

```
Discord / Voice / Notion
        ↓
   SQLite (NanoClaw queue)
        ↓
  Kjell Inge agent (Claude, in container)
        ↓
   Supabase (source of truth)
        ↓
   notion-sync.ts (host-side daemon)
        ↓
   Notion database (visual layer)
```

Voice memos and Notion inbound items inject into the SQLite queue via host-side scripts that run as systemd services (they need direct filesystem and database access that containers can't provide).

---

## Prerequisites

Before installing, complete:

1. `npm install` and `npm run build`
2. `/setup` — NanoClaw base install (Docker, service, SQLite)
3. `/add-discord` — Discord bot connected, second-brain channel registered

Optional but recommended:
- `/use-local-whisper` — install whisper.cpp for voice transcription (macOS: `brew install whisper-cpp`)

---

## Installation

Run in this order:

```
/setup-second-brain        ← main orchestrator, covers steps 1–4 and 8–9
/add-voice-watcher         ← optional: voice memo ingestion
```

`/setup-second-brain` will prompt you through Supabase setup and ask if you want Notion sync. It will also write all CLAUDE.md files and register the daily/weekly scheduled jobs.

---

## Environment Variables

All written to `.env` by the skills. Synced to `data/env/env` for container access.

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Project URL from Supabase settings |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (not anon key) |
| `NOTION_API_KEY` | Optional | Notion integration token |
| `NOTION_DATABASE_ID` | Optional | ID of the Second Brain Notion database |
| `NOTION_SETUP_AFTER` | Auto-set | ISO timestamp; pages before this are ignored for inbound sync |
| `VOICE_MEMOS_PATH` | Optional | Path to Dropbox voice memos folder (default: `~/Dropbox/Voice Memos`) |
| `WHISPER_MODEL` | Optional | Path to ggml model file (default: `data/models/ggml-base.bin`) |
| `WHISPER_BIN` | Optional | whisper binary name (default: `whisper-cli`) |

---

## Supabase Schema

Two tables in `supabase/schema.sql`:

**`items`** — everything captured:
- `type`: `task` / `idea` / `reflection` / `note`
- `status`: `open` / `done` / `archived`
- `source`: `discord` / `voice` / `notion`
- `tags[]` — free tags added by agent or user
- `notion_id` — linked Notion page
- Full-text search via `to_tsvector` GIN index

**`user_meta`** — weekly reflection snapshots written by the Sunday job.

Run the schema once in the Supabase SQL editor or via psql. `/add-supabase` automates this.

---

## Notion Database

One database called **Second Brain** with these properties:

| Property | Type | Notes |
|----------|------|-------|
| Name | Title | Content (first 100 chars) |
| Full Content | Text | Full text |
| Type | Select | task / idea / reflection / note |
| Status | Select | open / done / archived |
| Tags | Multi-select | |
| Source | Select | discord / voice / notion |
| Supabase ID | Text | UUID — sync key, do not edit |
| Captured At | Date | Original capture time |
| Synced At | Date | Updated on each sync pass |

Sync runs every 2 minutes via a systemd timer. Status changes made in Notion propagate back to Supabase automatically.

---

## Agent Commands

Send these in Discord (no @mention needed):

| Command | What it does |
|---------|-------------|
| Any message | Captured, classified, stored |
| `done` (reply to bot) | Marks item done |
| `expand` (reply to bot) | Writes a longer version |
| `search <query>` | Full-text search, top 5 |
| `list tasks` | All open tasks |
| `archive <description>` | Archives matching item |
| `tag <description> <tag>` | Tags matching item |

---

## Classification

Kjell Inge classifies every item:
- **task** — actionable, a commitment
- **idea** — speculative, worth exploring
- **reflection** — personal, emotional, retrospective
- **note** — reference, facts, quotes

Confirmation reply format (one line per item):
```
✅ task — buy milk
💡 idea — app design approach
🤔 reflection — feeling overwhelmed today
📝 note — interesting stat from article
```

---

## Scheduled Jobs

| Job | Schedule | What it does |
|-----|----------|-------------|
| Daily nudge | 08:00 daily | Surfaces stale tasks, lonely ideas, patterns. Silent if nothing worth saying. |
| Weekly reflection | Sunday 20:00 | Candid observations on the week's captures. Writes to `user_meta`. |

Both run as isolated NanoClaw agent tasks (no session history — fresh context each run). Registered directly in the `scheduled_tasks` SQLite table.

---

## Host-Side Services

Two scripts run on the host (not in containers) because they need direct SQLite write access:

### voice-watcher

`scripts/voice-watcher.ts` — polls `VOICE_MEMOS_PATH` every 30 seconds.

```bash
# Check status
systemctl --user status nanoclaw-voice-watcher

# Logs
tail -f logs/voice-watcher.log

# State (processed filenames)
cat groups/<folder>/voice-watcher-state.json
```

### notion-sync

`scripts/notion-sync.ts` — runs once per timer tick (every 2 minutes).

```bash
# Check timer
systemctl --user list-timers | grep notion-sync

# Logs
tail -f logs/notion-sync.log

# Notion errors
tail -f logs/notion-errors.log
```

---

## Verification

After install, confirm all of these work:

```bash
# 1. Supabase helpers work
source groups/global/supabase-helpers.sh
sb_insert_item "test item" "note" "discord"
# → returns a UUID

# 2. SQLite scheduled tasks registered
sqlite3 store/messages.db \
  "SELECT schedule_type, schedule_value, status FROM scheduled_tasks"
# → two rows: cron 0 8 * * *, cron 0 20 * * 0

# 3. Services running (Linux)
systemctl --user status nanoclaw-voice-watcher
systemctl --user list-timers | grep notion-sync

# 4. Send a test Discord message
# → agent replies with emoji-formatted capture summary within 5 seconds

# 5. Check it's in Supabase
sb_get_recent 1
# → JSON array with your test item

# 6. Check it appears in Notion within 2 minutes
```

---

## Troubleshooting

**Agent not responding to messages**: Check `requires_trigger = 0` in the registered_groups table. All messages must be processed without @mention.

**Supabase calls failing**: Ensure `data/env/env` exists and contains `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Re-run `cp .env data/env/env` and restart NanoClaw.

**Voice watcher silent**: Check `logs/voice-watcher.log`. Verify `whisper-cli` is in PATH used by the service. Test manually: `whisper-cli -m data/models/ggml-base.bin -f <file.wav> --no-timestamps -nt`.

**Notion sync stuck**: Check `logs/notion-errors.log`. Most common cause: Notion integration not connected to the database (Notion page → ⋯ → Connect to).

**Duplicate items from Notion inbound**: `NOTION_SETUP_AFTER` filters out old pages. If still duplicating, check `Supabase ID` property is being written back correctly after first sync.

**Scheduled jobs not firing**: `sqlite3 store/messages.db "SELECT id, status, next_run FROM scheduled_tasks"`. If `next_run` is in the past, the scheduler (60s poll) should pick them up. If status is not `active`, update it: `UPDATE scheduled_tasks SET status='active' WHERE ...`.
