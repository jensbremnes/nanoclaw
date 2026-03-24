<p align="center">
  <img src="assets/nanoclaw-logo.png" alt="NanoClaw" width="400">
</p>

<p align="center">
  An AI assistant that runs agents securely in their own containers. Lightweight, built to be easily understood and completely customized for your needs.
</p>

<p align="center">
  <a href="https://nanoclaw.dev">nanoclaw.dev</a>&nbsp; • &nbsp;
  <a href="README_zh.md">中文</a>&nbsp; • &nbsp;
  <a href="https://discord.gg/VDdww8qS42"><img src="https://img.shields.io/discord/1470188214710046894?label=Discord&logo=discord&v=2" alt="Discord" valign="middle"></a>&nbsp; • &nbsp;
  <a href="repo-tokens"><img src="repo-tokens/badge.svg" alt="34.9k tokens, 17% of context window" valign="middle"></a>
</p>

---

<h2 align="center">🐳 Now Runs in Docker Sandboxes</h2>
<p align="center">Every agent gets its own isolated container inside a micro VM.<br>Hypervisor-level isolation. Millisecond startup. No complex setup.</p>

**macOS (Apple Silicon)**
```bash
curl -fsSL https://nanoclaw.dev/install-docker-sandboxes.sh | bash
```

**Windows (WSL)**
```bash
curl -fsSL https://nanoclaw.dev/install-docker-sandboxes-windows.sh | bash
```

> Currently supported on macOS (Apple Silicon) and Windows (x86). Linux support coming soon.

<p align="center"><a href="https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes">Read the announcement →</a>&nbsp; · &nbsp;<a href="docs/docker-sandboxes.md">Manual setup guide →</a></p>

---

## Why I Built NanoClaw

[OpenClaw](https://github.com/openclaw/openclaw) is an impressive project, but I wouldn't have been able to sleep if I had given complex software I didn't understand full access to my life. OpenClaw has nearly half a million lines of code, 53 config files, and 70+ dependencies. Its security is at the application level (allowlists, pairing codes) rather than true OS-level isolation. Everything runs in one Node process with shared memory.

NanoClaw provides that same core functionality, but in a codebase small enough to understand: one process and a handful of files. Claude agents run in their own Linux containers with filesystem isolation, not merely behind permission checks.

## Quick Start

```bash
gh repo fork qwibitai/nanoclaw --clone
cd nanoclaw
claude
```

<details>
<summary>Without GitHub CLI</summary>

1. Fork [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw) on GitHub (click the Fork button)
2. `git clone https://github.com/<your-username>/nanoclaw.git`
3. `cd nanoclaw`
4. `claude`

</details>

Then run `/setup`. Claude Code handles everything: dependencies, authentication, container setup and service configuration.

> **Note:** Commands prefixed with `/` (like `/setup`, `/add-whatsapp`) are [Claude Code skills](https://code.claude.com/docs/en/skills). Type them inside the `claude` CLI prompt, not in your regular terminal. If you don't have Claude Code installed, get it at [claude.com/product/claude-code](https://claude.com/product/claude-code).

## Philosophy

**Small enough to understand.** One process, a few source files and no microservices. If you want to understand the full NanoClaw codebase, just ask Claude Code to walk you through it.

**Secure by isolation.** Agents run in Linux containers (Apple Container on macOS, or Docker) and they can only see what's explicitly mounted. Bash access is safe because commands run inside the container, not on your host.

**Built for the individual user.** NanoClaw isn't a monolithic framework; it's software that fits each user's exact needs. Instead of becoming bloatware, NanoClaw is designed to be bespoke. You make your own fork and have Claude Code modify it to match your needs.

**Customization = code changes.** No configuration sprawl. Want different behavior? Modify the code. The codebase is small enough that it's safe to make changes.

**AI-native.**
- No installation wizard; Claude Code guides setup.
- No monitoring dashboard; ask Claude what's happening.
- No debugging tools; describe the problem and Claude fixes it.

**Skills over features.** Instead of adding features (e.g. support for Telegram) to the codebase, contributors submit [claude code skills](https://code.claude.com/docs/en/skills) like `/add-telegram` that transform your fork. You end up with clean code that does exactly what you need.

**Best harness, best model.** NanoClaw runs on the Claude Agent SDK, which means you're running Claude Code directly. Claude Code is highly capable and its coding and problem-solving capabilities allow it to modify and expand NanoClaw and tailor it to each user.

## What It Supports

- **Multi-channel messaging** - Talk to your assistant from WhatsApp, Telegram, Discord, Slack, or Gmail. Add channels with skills like `/add-whatsapp` or `/add-telegram`. Run one or many at the same time.
- **Isolated group context** - Each group has its own `CLAUDE.md` memory, isolated filesystem, and runs in its own container sandbox with only that filesystem mounted to it.
- **Main channel** - Your private channel (self-chat) for admin control; every group is completely isolated
- **Scheduled tasks** - Recurring jobs that run Claude and can message you back
- **Web access** - Search and fetch content from the Web
- **Container isolation** - Agents are sandboxed in [Docker Sandboxes](https://nanoclaw.dev/blog/nanoclaw-docker-sandboxes) (micro VM isolation), Apple Container (macOS), or Docker (macOS/Linux)
- **Agent Swarms** - Spin up teams of specialized agents that collaborate on complex tasks
- **Optional integrations** - Add Gmail (`/add-gmail`) and more via skills

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am (has access to my Obsidian vault folder)
@Andy review the git history for the past week each Friday and update the README if there's drift
@Andy every Monday at 8am, compile news on AI developments from Hacker News and TechCrunch and message me a briefing
```

From the main channel (your self-chat), you can manage groups and tasks:
```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Customizing

NanoClaw doesn't use configuration files. To make changes, just tell Claude Code what you want:

- "Change the trigger word to @Bob"
- "Remember in the future to make responses shorter and more direct"
- "Add a custom greeting when I say good morning"
- "Store conversation summaries weekly"

Or run `/customize` for guided changes.

The codebase is small enough that Claude can safely modify it.

## Contributing

**Don't add features. Add skills.**

If you want to add Telegram support, don't create a PR that adds Telegram to the core codebase. Instead, fork NanoClaw, make the code changes on a branch, and open a PR. We'll create a `skill/telegram` branch from your PR that other users can merge into their fork.

Users then run `/add-telegram` on their fork and get clean code that does exactly what they need, not a bloated system trying to support every use case.

### RFS (Request for Skills)

Skills we'd like to see:

**Communication Channels**
- `/add-signal` - Add Signal as a channel

**Session Management**
- `/clear` - Add a `/clear` command that compacts the conversation (summarizes context while preserving critical information in the same session). Requires figuring out how to trigger compaction programmatically via the Claude Agent SDK.

## Requirements

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Apple Container](https://github.com/apple/container) (macOS) or [Docker](https://docker.com/products/docker-desktop) (macOS/Linux)

## Architecture

```
Channels --> SQLite --> Polling loop --> Container (Claude Agent SDK) --> Response
```

Single Node.js process. Channels are added via skills and self-register at startup — the orchestrator connects whichever ones have credentials present. Agents execute in isolated Linux containers with filesystem isolation. Only mounted directories are accessible. Per-group message queue with concurrency control. IPC via filesystem.

For the full architecture details, see [docs/SPEC.md](docs/SPEC.md).

Key files:
- `src/index.ts` - Orchestrator: state, message loop, agent invocation
- `src/channels/registry.ts` - Channel registry (self-registration at startup)
- `src/ipc.ts` - IPC watcher and task processing
- `src/router.ts` - Message formatting and outbound routing
- `src/group-queue.ts` - Per-group queue with global concurrency limit
- `src/container-runner.ts` - Spawns streaming agent containers
- `src/task-scheduler.ts` - Runs scheduled tasks
- `src/db.ts` - SQLite operations (messages, groups, sessions, state)
- `groups/*/CLAUDE.md` - Per-group memory

## FAQ

**Why Docker?**

Docker provides cross-platform support (macOS, Linux and even Windows via WSL2) and a mature ecosystem. On macOS, you can optionally switch to Apple Container via `/convert-to-apple-container` for a lighter-weight native runtime.

**Can I run this on Linux?**

Yes. Docker is the default runtime and works on both macOS and Linux. Just run `/setup`.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. You should still review what you're running, but the codebase is small enough that you actually can. See [docs/SECURITY.md](docs/SECURITY.md) for the full security model.

**Why no configuration files?**

We don't want configuration sprawl. Every user should customize NanoClaw so that the code does exactly what they want, rather than configuring a generic system. If you prefer having config files, you can tell Claude to add them.

**Can I use third-party or open-source models?**

Yes. NanoClaw supports any Claude API-compatible model endpoint. Set these environment variables in your `.env` file:

```bash
ANTHROPIC_BASE_URL=https://your-api-endpoint.com
ANTHROPIC_AUTH_TOKEN=your-token-here
```

This allows you to use:
- Local models via [Ollama](https://ollama.ai) with an API proxy
- Open-source models hosted on [Together AI](https://together.ai), [Fireworks](https://fireworks.ai), etc.
- Custom model deployments with Anthropic-compatible APIs

Note: The model must support the Anthropic API format for best compatibility.

**How do I debug issues?**

Ask Claude Code. "Why isn't the scheduler running?" "What's in the recent logs?" "Why did this message not get a response?" That's the AI-native approach that underlies NanoClaw.

**Why isn't the setup working for me?**

If you have issues, during setup, Claude will try to dynamically fix them. If that doesn't work, run `claude`, then run `/debug`. If Claude finds an issue that is likely affecting other users, open a PR to modify the setup SKILL.md.

**What changes will be accepted into the codebase?**

Only security fixes, bug fixes, and clear improvements will be accepted to the base configuration. That's all.

Everything else (new capabilities, OS compatibility, hardware support, enhancements) should be contributed as skills.

This keeps the base system minimal and lets every user customize their installation without inheriting features they don't want.

## Community

Questions? Ideas? [Join the Discord](https://discord.gg/VDdww8qS42).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for breaking changes and migration notes.

## License

MIT

---

# Kjell Inge — Second Brain on NanoClaw

A personal second-brain system built on top of NanoClaw. The agent — **Kjell Inge** — captures thoughts, tasks, ideas, and reflections from three sources and keeps everything organised in Supabase, mirrored to Notion.

## Capture Sources

| Source | How it works |
|--------|-------------|
| **Discord** | Send any message to the bot channel — no @mention needed |
| **Voice memos** | Record on iPhone → syncs via Dropbox → transcribed locally |
| **Notion** | Type directly into the Second Brain database → agent processes it |

## Second Brain Architecture

```
Discord / Voice / Notion
        ↓
   SQLite (NanoClaw queue)
        ↓
  Kjell Inge agent (Claude, in container)
        ↓
   Supabase (source of truth)
        ↓          ↓           ↓            ↓
notion-sync.ts  elaborator  weekly-digest  dashboard-server.ts
(PARA Notion    (auto-       (Sun digest    (local web UI
 hub mirror)     elaboration) Notion page)   :8181)
```

Voice memos and Notion inbound items inject into the SQLite queue via host-side scripts that run as systemd services (they need direct filesystem and database access that containers can't provide).

## Second Brain Prerequisites

Before installing, complete:

1. `npm install` and `npm run build`
2. `/setup` — NanoClaw base install (Docker, service, SQLite)
3. `/add-discord` — Discord bot connected, second-brain channel registered

Optional but recommended:
- `/use-local-whisper` — install whisper.cpp for voice transcription (macOS: `brew install whisper-cpp`)

## Second Brain Installation

Run in this order:

```
/setup-second-brain        ← main orchestrator, covers steps 1–4 and 8–9
/add-voice-watcher         ← optional: voice memo ingestion
```

`/setup-second-brain` will prompt you through Supabase setup and ask if you want Notion sync. It will also write all CLAUDE.md files and register the daily/weekly scheduled jobs.

## Second Brain Environment Variables

All written to `.env` by the skills. Synced to `data/env/env` for container access.

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Project URL from Supabase settings |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (not anon key) |
| `NOTION_API_KEY` | Optional | Notion integration token |
| `NOTION_DATABASE_ID` | Optional | ID of the Second Brain Notion database (flat DB, existing) |
| `NOTION_HUB_PAGE_ID` | Optional | ID of the master "🧠 Second Brain" PARA hub page |
| `NOTION_SETUP_AFTER` | Auto-set | ISO timestamp; pages before this are ignored for inbound sync |
| `ELABORATOR_MODEL` | Optional | Claude model for auto-elaboration (default: `claude-haiku-4-5-20251001`) |
| `VOICE_MEMOS_PATH` | Optional | Path to Dropbox voice memos folder (default: `~/Dropbox/Voice Memos`) |
| `WHISPER_MODEL` | Optional | Path to ggml model file (default: `data/models/ggml-base.bin`) |
| `WHISPER_BIN` | Optional | whisper binary name (default: `whisper-cli`) |
| `DASHBOARD_PORT` | Optional | Dashboard HTTP port (default: `8181`) |

## Supabase Schema

Tables defined in `supabase/schema.sql`. After initial setup, run `supabase/migrations/001_para_upgrade.sql` to add the PARA tables and columns.

**`items`** — everything captured:
- `type`: `task` / `idea` / `reflection` / `note`
- `status`: `open` / `done` / `archived`
- `source`: `discord` / `voice` / `notion`
- `tags[]` — auto-applied and user-set tags
- `notion_id` — linked flat-database Notion page (bidirectional sync)
- `notion_hub_page_id` — linked PARA hub Notion page (with rich body)
- `elaboration` — AI-generated elaboration from `elaborator.ts`
- `project_id` — optional link to a project
- `related_item_ids[]` — semantically related items found by elaborator
- Full-text search via `to_tsvector` GIN index

**`projects`** — active projects and areas:
- `para_category`: `projects` / `areas` / `resources`
- Links to `goals` via `goal_id`
- Syncs to the Projects database in the Notion hub

**`goals`** — long-term goals linked to projects. Syncs to Goals database in Notion.

**`weekly_digests`** — AI-generated weekly summaries:
- Written by `weekly-digest.ts` every Sunday at 22:00
- Synced to Notion as child pages under "📅 Weekly Digests"

**`user_meta`** — weekly reflection snapshots written by the Sunday agent job.

## Notion Structure

### PARA Hub

Create a page called **🧠 Second Brain** in Notion, copy its ID into `NOTION_HUB_PAGE_ID`. On first run, `notion-sync.ts` auto-creates the full sub-structure:

```
🧠 Second Brain
├── 🗂 Projects   ← syncs projects table
├── 🎯 Goals      ← syncs goals table
├── 📋 Tasks      ← task items with AI elaboration in page body
├── 📚 Resources  ← idea + note items with AI elaboration
├── 🪞 Reflections ← reflection items with AI elaboration
├── 📦 Archive    ← archived items
└── 📅 Weekly Digests ← one page per week, AI-generated narrative
```

Each item page body contains:
- **Original Capture** — quoted verbatim
- **Elaboration** — AI-generated (context, subtasks/expansion, next steps, related concepts)
- **Metadata** — type, source, captured date

### Flat Database (legacy, unchanged)

The original **Second Brain** database (`NOTION_DATABASE_ID`) continues to work as before. Properties:

| Property | Type | Notes |
|----------|------|-------|
| Navn | Title | Content (first 100 chars) |
| Full Content | Text | Full text |
| Type | Select | task / idea / reflection / note |
| Status | Select | open / done / archived |
| Tags | Multi-select | |
| Source | Select | discord / voice / notion |
| Supabase ID | Text | UUID — sync key, do not edit |
| Captured At | Date | Original capture time |
| Synced At | Date | Updated on each sync pass |

Bidirectional status sync still runs every 2 minutes. Status changes in the flat database propagate back to Supabase automatically.

## Agent Commands

Send these in Discord (no @mention needed):

| Command | What it does |
|---------|-------------|
| Any message | Captured, classified, stored |
| `done` (reply to bot) | Marks item done |
| `expand` (reply to bot) | Immediate inline expansion (3–5 sentences) |
| `related` (reply to bot) | Lists semantically related items |
| `search <query>` | Full-text search, top 5 |
| `list tasks` | All open tasks |
| `list projects` | All active projects |
| `create project <name>` | Creates a project (prompts for description/category) |
| `assign <description> to <project>` | Links item to a project |
| `archive <description>` | Archives matching item |
| `tag <description> <tag>` | Tags matching item |

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

## Scheduled Jobs

| Job | Schedule | What it does |
|-----|----------|-------------|
| Daily nudge | 08:00 daily | Surfaces stale tasks, lonely ideas, patterns. Silent if nothing worth saying. |
| Weekly reflection | Sunday 20:00 | Candid observations on the week's captures. Writes to `user_meta`. |
| Weekly digest | Sunday 22:00 | `weekly-digest.ts` generates an AI narrative of the week → Notion page auto-created. |

Both run as isolated NanoClaw agent tasks (no session history — fresh context each run). Registered directly in the `scheduled_tasks` SQLite table.

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

### dashboard

`scripts/dashboard-server.ts` — serves a modern card-based web UI at `http://127.0.0.1:8181` (configurable via `DASHBOARD_PORT`).

Filter items by type, status, tag, or search. Mark items done or archived with one click — changes write to Supabase and sync to Notion automatically within 2 minutes via `notion-sync.ts`.

**Install** (one-time, after running `/setup-second-brain`):

```bash
cp scripts/dashboard.service ~/.config/systemd/user/nanoclaw-dashboard.service
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-dashboard.service
```

```bash
# Check status
systemctl --user status nanoclaw-dashboard

# Logs
tail -f logs/dashboard.log

# Open
open http://127.0.0.1:8181   # macOS
xdg-open http://127.0.0.1:8181  # Linux
```

### elaborator

`scripts/elaborator.ts` — runs every 5 minutes. Picks up items with no elaboration, calls Claude API with a type-specific prompt, finds related items via keyword and tag matching, stores results in Supabase. On the next `notion-sync.ts` run, elaboration appears in the item's Notion hub page body.

```bash
# Check status
systemctl --user status nanoclaw-elaborator

# Check timer
systemctl --user list-timers | grep elaborator

# Logs
tail -f logs/elaborator.log

# Run manually
npx tsx scripts/elaborator.ts
```

### weekly-digest

`scripts/weekly-digest.ts` — runs Sunday at 22:00. Fetches all items captured during the week, completed tasks, and the user's own reflection. Calls Claude API to generate a narrative digest. Inserts into `weekly_digests` table; `notion-sync.ts` creates the Notion page on the next run.

```bash
# Check timer
systemctl --user list-timers | grep weekly-digest

# Logs
tail -f logs/weekly-digest.log

# Run manually
npx tsx scripts/weekly-digest.ts
```

### bridge-url

NanoClaw automatically sends the `claude-remote` bridge URL to all registered Discord channels 60 seconds after startup — no manual script needed.

**How it works:**
- 60 seconds after all channels connect, `src/index.ts` runs `journalctl -u claude-remote -n 20 --no-pager` on the host
- If a `https://claude.ai/code?bridge=...` URL is found, it is sent to all registered groups
- If the URL is not ready yet (e.g. `claude-remote` started after NanoClaw), ask the bot: **"send me the bridge URL"**
  - The agent writes a `get_bridge_url` IPC command and the host fetches + sends the URL on demand

## Second Brain Verification

After install, confirm all of these work:

```bash
# 1. Supabase helpers work
source groups/global/supabase-helpers.sh
sb_insert_item "test item" "note" "discord"
# → returns a UUID

sb_list_projects
# → [] (empty array, no error)

# 2. SQLite scheduled tasks registered
sqlite3 store/messages.db \
  "SELECT schedule_type, schedule_value, status FROM scheduled_tasks"
# → two rows: cron 0 8 * * *, cron 0 20 * * 0

# 3. Services and timers running (Linux)
systemctl --user status nanoclaw-voice-watcher
systemctl --user list-timers | grep -E "notion-sync|elaborator|weekly-digest"

# 4. Send a test Discord message
# → agent replies with emoji-formatted capture summary within 5 seconds

# 5. Check it's in Supabase
sb_get_recent 1
# → JSON array with your test item (elaboration will be null initially)

# 6. Run elaborator manually — elaboration should appear within seconds
npx tsx scripts/elaborator.ts
sb_get_elaboration <item-uuid>
# → AI elaboration text

# 7. Check item appears in Notion flat DB within 2 minutes
# → after notion-sync runs, check the flat database

# 8. PARA hub: add NOTION_HUB_PAGE_ID to data/env/env, then:
npx tsx scripts/notion-sync.ts
# → logs/notion-hub-state.json should contain 7 Notion IDs
# → hub page in Notion should have 6 sub-databases + Weekly Digests page

# 9. Run weekly digest manually
npx tsx scripts/weekly-digest.ts
# → weekly_digests table has a new row
# → after next notion-sync run, a digest page appears in Notion
```

## Second Brain Troubleshooting

**Agent not responding to messages**: Check `requires_trigger = 0` in the registered_groups table. All messages must be processed without @mention.

**Supabase calls failing**: Ensure `data/env/env` exists and contains `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Re-run `cp .env data/env/env` and restart NanoClaw.

**Voice watcher silent**: Check `logs/voice-watcher.log`. Verify `whisper-cli` is in PATH used by the service. Test manually: `whisper-cli -m data/models/ggml-base.bin -f <file.wav> --no-timestamps -nt`.

**Notion sync stuck**: Check `logs/notion-errors.log`. Most common cause: Notion integration not connected to the database (Notion page → ⋯ → Connect to).

**Duplicate items from Notion inbound**: `NOTION_SETUP_AFTER` filters out old pages. If still duplicating, check `Supabase ID` property is being written back correctly after first sync.

**Elaboration not appearing in Notion**: Check `logs/elaborator.log` for Claude API errors. Ensure `ANTHROPIC_API_KEY` is set in `data/env/env`. After elaboration appears in Supabase, the next `notion-sync.ts` run writes it to the hub page body — check `elaboration_synced_at` in Supabase is being updated.

**Hub structure not creating**: `NOTION_HUB_PAGE_ID` must be set in `data/env/env`. Check `logs/notion-hub-state.json` — if it has all 7 IDs, the structure exists. Verify the Notion integration token has access to the hub page (open the page in Notion → ⋯ → Connect to → select your integration).

**Weekly digest not appearing**: Run `npx tsx scripts/weekly-digest.ts` manually and check `logs/weekly-digest.log`. The digest is idempotent — if a row already exists for this `week_start`, it skips. Delete the row in Supabase to force regeneration. Notion page is created on the next `notion-sync.ts` run after digest insertion.

**Scheduled jobs not firing**: `sqlite3 store/messages.db "SELECT id, status, next_run FROM scheduled_tasks"`. If `next_run` is in the past, the scheduler (60s poll) should pick them up. If status is not `active`, update it: `UPDATE scheduled_tasks SET status='active' WHERE ...`.
