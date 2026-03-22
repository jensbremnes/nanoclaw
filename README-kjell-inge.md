# Kjell Inge — Your Personal Second Brain

This is your personal setup guide. It explains what's running on your server,
how it all connects, and what to do when you want to change something.

---

## What Is This Thing?

NanoClaw is a personal AI assistant that runs on your server 24/7. You talk to
it through Discord. It uses Claude AI (Anthropic) to respond.

On top of that, you've set up a "second brain" layer: everything you type to
the assistant gets captured, classified, and stored — so you can search it,
act on it, and review it later.

Think of it as a combination of:
- A smart Discord bot (answers questions, does web research, etc.)
- A personal inbox where thoughts, tasks, and ideas don't get lost
- A Notion mirror so you have a visual view of everything captured

---

## Big Picture

```
  You (iPhone/Desktop)
         │
         │ Discord message
         ▼
  ┌──────────────────────────────────────────────────────────┐
  │                     Your Server                          │
  │                                                          │
  │   Discord Bot ──► NanoClaw Orchestrator                 │
  │   (Kjell Inge)          │                               │
  │                         │ spawns                        │
  │                         ▼                               │
  │                   Docker Container                       │
  │                   (isolated Claude AI)                   │
  │                         │                               │
  │                         │ response                      │
  │                         ▼                               │
  │              Back to Discord channel                     │
  │                                                          │
  │   ┌──────────────────────────────────────────┐          │
  │   │  Background: Notion Sync (every 2 min)   │          │
  │   └──────────────────────────────────────────┘          │
  └──────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
      Supabase                       Notion
  (captures stored here)       (visual view of captures)


  Future: iPhone Voice Memos ──► Dropbox ──► Server ──► Second Brain
```

---

## How a Message Gets Processed

Here is exactly what happens when you type something in Discord:

```
1. You type in Discord
         │
         ▼
2. Discord bot receives the message
   Stores it in SQLite database (store/messages.db)
         │
         ▼
3. NanoClaw polls the database every 2 seconds
   "Any new messages since I last checked?"
         │
         ▼
4. Trigger check
   Because this is the second-brain channel, ALL messages
   are processed (no need to @mention the bot)
         │
         ▼
5. A Docker container is spawned
   This is an isolated Linux mini-environment.
   The AI (Claude) runs inside it.
   It can only see YOUR group folder — not the rest of the server.
         │
         ▼
6. Claude processes the message
   Reads your CLAUDE.md instructions
   Classifies: task / idea / reflection / note
   Saves to Supabase
   Sends response back
         │
         ▼
7. Response appears in Discord
         │
         ▼
8. Within ~2 minutes: Notion sync daemon runs
   New items appear in your Notion database
```

---

## Your Active Integrations

| Integration  | What It Does                              | Status              |
|-------------|-------------------------------------------|---------------------|
| Discord      | Messages in and out                       | ✅ Running          |
| Supabase     | Stores all captured items (the database)  | ✅ Running          |
| Notion       | Visual view, two-way sync                 | ✅ Running          |
| Voice Memos  | iPhone voice → transcribe → capture       | ⏳ Needs Dropbox    |

---

## The Second Brain — What Gets Captured

Every message you send to the Discord channel gets classified into one of four types:

```
  Your message: "buy milk, and I had a thought about redesigning the app,
                 feeling anxious about the deadline"

  Agent splits and classifies:

  ✅ task        "buy milk"
  💡 idea        "redesigning the app"
  🤔 reflection  "feeling anxious about the deadline"
```

Each item is saved to Supabase with a UUID, timestamp, type, and status.

### Capture Pipeline

```
  Discord message
       │
       ▼
  Agent parses into separate items
       │
       ▼
  Each item classified: task / idea / reflection / note
       │
       ▼
  sb_insert_item() → saved to Supabase (items table)
       │
       ▼
  Notion sync daemon picks it up within 2 minutes
       │
       ▼
  Appears in your Notion database
```

---

## Notion Sync Pipeline

```
  ┌──────────────┐        every 2 min        ┌──────────────┐
  │   Supabase   │ ◄─────────────────────── │  Notion Sync  │
  │  (items DB)  │ ──────────────────────── │    Daemon     │
  └──────────────┘   two-way sync            └──────────────┘
                                                     │
                                             ┌───────┴────────┐
                                             │                │
                                       Outbound           Inbound
                              (Supabase → Notion)  (Notion → Supabase)
                              new items get           items created
                              Notion pages            in Notion UI
                                                      come into
                                                      the agent
```

This means you can capture items directly in Notion too — type something in
your Notion database and it will appear in your second brain within 2 minutes.

---

## Scheduled Tasks

Two automated tasks run on a schedule without you doing anything:

```
  Daily at 08:00
  ┌─────────────────────────────────────────────┐
  │  "Morning Nudge"                            │
  │  Checks for:                                │
  │  - Tasks open for 3+ days                  │
  │  - Lonely ideas with no follow-up          │
  │  - Patterns (same theme appearing 3+ times)│
  │  Sends ONE relevant nudge to Discord        │
  │  (stays quiet if nothing worth surfacing)  │
  └─────────────────────────────────────────────┘

  Every Sunday at 20:00
  ┌─────────────────────────────────────────────┐
  │  "Weekly Reflection"                        │
  │  Reads all captures from the past 7 days    │
  │  Writes honest observations about:          │
  │  - What you've been thinking about          │
  │  - Recurring themes                         │
  │  - Things started but not finished          │
  │  Sends to Discord, stores in Supabase       │
  └─────────────────────────────────────────────┘
```

---

## Commands You Can Use in Discord

Type these in the second-brain Discord channel:

| Command                        | What Happens                                      |
|-------------------------------|---------------------------------------------------|
| Any text                       | Captured and classified automatically             |
| `list tasks`                   | Shows all open tasks                              |
| `search morning routine`       | Finds items matching that query                   |
| Reply "done" to a bot message  | Marks that item as done in Supabase               |
| Reply "expand" to a bot message| Generates a 3-5 sentence elaboration             |
| `archive <description>`        | Archives matching item (asks for confirmation)    |
| `tag <description> <tag>`      | Adds a tag to matching item                       |

---

## Running Services

Three things are always running on your server:

```
  nanoclaw.service
  ├── The main orchestrator
  ├── Runs node dist/index.js
  ├── Auto-restarts if it crashes
  └── Logs: logs/nanoclaw.log

  nanoclaw-notion-sync.timer
  ├── Fires every 2 minutes
  ├── Runs scripts/notion-sync.ts
  └── Logs: logs/notion-sync.log

  (future) nanoclaw-voice-watcher.service
  ├── Watches Dropbox folder for voice memos
  ├── Transcribes with whisper-cpp
  └── Injects into second brain
```

Useful service commands:
```bash
# Check if running
systemctl --user status nanoclaw

# Restart (e.g. after changing a config file)
systemctl --user restart nanoclaw

# Watch live logs
tail -f logs/nanoclaw.log

# Watch Notion sync logs
tail -f logs/notion-sync.log
```

---

## Most Important Files

These are the files you'll actually want to edit or know about:

### Agent Personality and Behavior

```
groups/global/CLAUDE.md
```
This is the "system prompt" for all groups. It defines who Kjell Inge is,
what tone to use, what capabilities are available, and how to format messages.

**Edit this to:** change tone, add global capabilities, update language settings.

```
groups/discord_second-brain/CLAUDE.md
```
This overrides the global config specifically for your second brain channel.
It contains the classification logic, capture format, and command handling.

**Edit this to:** change how items are classified, add new commands, change
the capture confirmation format.

### Credentials and Secrets

```
.env
```
All API keys and tokens. Never commit this to git.

```
data/env/env
```
A copy of `.env` that gets mounted into Docker containers. After changing
`.env`, run `cp .env data/env/env` to sync it.

Keys currently configured:
- `DISCORD_BOT_TOKEN` — Discord bot identity
- `CLAUDE_CODE_OAUTH_TOKEN` — Claude AI authentication
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` — database access
- `NOTION_API_KEY` + `NOTION_DATABASE_ID` — Notion sync
- `NOTION_SETUP_AFTER` — prevents old Notion items from flooding inbound sync

### Database

```
store/messages.db
```
SQLite database. Contains:
- `messages` — full message history
- `registered_groups` — which Discord channels are active
- `scheduled_tasks` — daily nudge and weekly reflection jobs
- `chats` — metadata for all known channels

You don't edit this directly — use Node.js scripts or the agent commands.

### Systemd Services

```
~/.config/systemd/user/nanoclaw.service
~/.config/systemd/user/nanoclaw-notion-sync.service
~/.config/systemd/user/nanoclaw-notion-sync.timer
```

### Shared Helper Scripts (used by the AI inside containers)

```
groups/global/supabase-helpers.sh   — functions to read/write Supabase
groups/global/notion-helpers.sh     — functions to interact with Notion
```

---

## Directory Structure

```
/home/jens/nanoclaw/
│
├── src/                        TypeScript source code
│   ├── index.ts                Main orchestrator (the brain)
│   ├── container-runner.ts     Spawns Docker containers
│   ├── task-scheduler.ts       Runs scheduled tasks
│   ├── channels/
│   │   ├── discord.ts          Discord bot implementation
│   │   └── registry.ts         Channel registration system
│   ├── db.ts                   SQLite operations
│   └── router.ts               Outbound message routing
│
├── dist/                       Compiled JavaScript (auto-generated)
│
├── groups/
│   ├── global/                 Shared across all groups
│   │   ├── CLAUDE.md           Global agent identity
│   │   ├── supabase-helpers.sh Supabase API functions
│   │   └── notion-helpers.sh   Notion API functions
│   └── discord_second-brain/   Your second brain group
│       ├── CLAUDE.md           Second brain agent config
│       └── logs/               Container execution logs
│
├── scripts/
│   ├── notion-sync.ts          Notion ↔ Supabase sync daemon (host-side)
│   └── voice-watcher.ts        Voice memo watcher (host-side, not yet active)
│
├── supabase/
│   └── schema.sql              Database schema (already applied)
│
├── store/
│   └── messages.db             SQLite database
│
├── logs/                       Service logs
│   ├── nanoclaw.log            Main service log
│   ├── nanoclaw.error.log      Error log
│   ├── notion-sync.log         Notion sync log
│   └── notion-errors.log       Notion API errors
│
├── data/
│   ├── env/env                 Container-accessible copy of .env
│   ├── ipc/                    Inter-process communication (container ↔ host)
│   ├── models/                 AI models (whisper base.en downloaded)
│   └── sessions/               Per-group Claude session state
│
└── .env                        All secrets (never commit to git)
```

---

## Supabase — What's Stored

Everything captured ends up in Supabase. Two tables:

**`items`** — your second brain content
```
id           UUID (unique identifier)
content      The full text of what you captured
type         task / idea / reflection / note
status       open / done / archived
tags         Array of tags
source       discord / voice / notion
notion_id    Link to Notion page (filled in after sync)
captured_at  When you sent the message
```

**`user_meta`** — weekly reflections
```
id           UUID
observation  The agent's weekly observation text
week_start   Monday date of that week
```

### Available Supabase Functions (used by the AI)

The agent has access to these shell functions when processing your messages:

| Function | What It Does |
|----------|-------------|
| `sb_insert_item` | Save a new captured item |
| `sb_update_status <id> done` | Mark item as done |
| `sb_archive_item <id>` | Archive an item |
| `sb_add_tag <id> <tag>` | Add a tag |
| `sb_get_item <id>` | Fetch one item by UUID |
| `sb_search_items <query>` | Full-text search |
| `sb_get_open_tasks` | All open tasks |
| `sb_get_recent <days>` | Items from last N days |
| `sb_get_items_by_type <type>` | Filter by task/idea/etc |
| `sb_write_user_meta` | Store weekly observation |

---

## How Containers Work (Beginner Explanation)

When you send a message, NanoClaw doesn't just run Claude directly on your
server. Instead it spawns a Docker container — think of it as a tiny
throwaway Linux computer that exists only for the duration of your request.

Why? Three reasons:
1. **Safety**: the AI can run bash commands and write files, but only inside
   its isolated box. It cannot touch your server files.
2. **Isolation**: each Discord group gets its own box with its own memory.
   Your second brain can't accidentally see another group's data.
3. **Secrets**: your API keys are never inside the container. The container
   talks to a "credential proxy" that handles authentication on its behalf.

The container gets:
- Your group folder (`groups/discord_second-brain/`) — writable
- The global helpers (`groups/global/`) — read-only
- Your env vars file (`data/env/env`) — read-only

It cannot see `.env`, `src/`, or any other group's folder.

---

## Making Changes — Quick Reference

| I want to...                          | Edit this                                              |
|--------------------------------------|--------------------------------------------------------|
| Change agent tone or personality      | `groups/global/CLAUDE.md`                             |
| Change how items are classified       | `groups/discord_second-brain/CLAUDE.md`               |
| Add a new capture command             | `groups/discord_second-brain/CLAUDE.md`               |
| Add another Discord server/channel   | Type `register` in that Discord channel               |
| Change daily nudge time              | Update `scheduled_tasks` in `store/messages.db`        |
| Add a new API key                     | Edit `.env`, then run `cp .env data/env/env`           |
| Rebuild after source code changes     | `npm run build`                                        |
| Restart everything                    | `systemctl --user restart nanoclaw`                   |
| Add WhatsApp/Telegram                 | Run the `/add-whatsapp` or `/add-telegram` skill      |

After editing `groups/global/CLAUDE.md` or `groups/discord_second-brain/CLAUDE.md`,
**no restart needed** — changes take effect on the next message.

After editing `.env`, run:
```bash
cp .env data/env/env
systemctl --user restart nanoclaw
```

---

## Troubleshooting

**Bot not responding in Discord**
```bash
tail -30 logs/nanoclaw.log
systemctl --user status nanoclaw
```

**Items not appearing in Notion**
```bash
tail -20 logs/notion-sync.log
tail -20 logs/notion-errors.log
systemctl --user status nanoclaw-notion-sync.timer
```

**Supabase writes failing**
```bash
tail -20 groups/discord_second-brain/logs/supabase-errors.log
```

**Container won't start (Docker image missing)**
```bash
docker images | grep nanoclaw
# If empty:
./container/build.sh
```

---

## Ideas for Future Improvements

These are things that could make the second brain more powerful, roughly
ranked by value:

### High Value

**Voice Memos (partially set up)**
The infrastructure is ready (whisper-cpp installed, model downloaded).
Just needs Dropbox linked to the server. Once done: record a voice memo
on iPhone → Dropbox syncs it → whisper transcribes → agent captures it.
Completely hands-free.

**WhatsApp or Telegram as second input channel**
Capture from your phone without opening Discord. You'd send messages to a
WhatsApp/Telegram bot and they'd flow into the same second brain. Run
`/add-telegram` or `/add-whatsapp` to set it up.

**Weekly email digest**
Every Monday morning, receive an email summary of last week's captures,
open tasks, and the agent's reflection. Needs a Gmail integration.

**Smarter nudges**
Right now nudges are based on age. Smarter version: agent learns which
topics you repeatedly capture but never act on, and specifically calls
those out.

### Quality of Life

**`/recap` command**
Type `recap this week` in Discord and get a summary of everything captured
in the past 7 days, grouped by type.

**Emoji reactions as "done"**
React with ✅ to a bot message in Discord to mark the item as done,
instead of typing "done". Requires the `/add-reactions` skill.

**Auto-tagging**
Items mentioning a person's name automatically get tagged with that name.
Items with dates get tagged with the month. Configurable in CLAUDE.md.

**Capture templates**
Type `meeting with X` and the agent uses a template to capture structured
notes (participants, decisions, action items) rather than free text.

### Advanced

**Web clipper**
Send a URL to Discord. Agent fetches the page, summarizes it, saves as a
note with the source URL. Good for articles you want to remember.

**Calendar integration**
Tasks with a specific date ("dentist on April 3rd") automatically create
a calendar event. Needs Google Calendar integration.

**Agent swarm**
Run separate sub-agents for different life areas (work vs. personal vs.
health). Each has its own Notion database and memory. Trigger with a
prefix: `work: finish the report` vs. `personal: buy milk`.

**Daily review prompt**
Every evening at 19:00, agent asks: "What did you get done today? Any
blockers?" — then automatically marks mentioned tasks as done and captures
new ones.

---

## Your Setup Summary

```
Server:    kjell-inge (Linux, systemd)
Assistant: Kjell Inge (Discord bot: Kjell Inge#6888)
Channel:   Kjell Inge server → #general (dc:1484975501545177211)
Trigger:   All messages (no @mention needed)

Services running:
  ✅ nanoclaw.service              (main orchestrator)
  ✅ nanoclaw-notion-sync.timer    (every 2 minutes)

Integrations:
  ✅ Discord    Kjell Inge#6888
  ✅ Supabase   etilqnlcmhpeizzyqdlq.supabase.co
  ✅ Notion     database 32b17becda0380458dc4ff4281a644e5
  ⏳ Voice      whisper ready, needs Dropbox

Scheduled:
  📅 Daily nudge    08:00 every day
  📅 Reflection     20:00 every Sunday
```
