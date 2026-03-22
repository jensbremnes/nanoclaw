---
name: setup-second-brain
description: Full Kjell Inge second-brain install. Orchestrates Supabase, CLAUDE.md files, helper scripts, and scheduled jobs.
---

# Setup Second Brain

Installs the complete Kjell Inge second-brain system on a NanoClaw instance that already has Discord configured.

**Prerequisites (must be done before this skill):**
- `/setup` — NanoClaw base setup complete
- `/add-discord` — Discord bot connected and a channel registered

## Phase 1: Verify Prerequisites

### Check Discord group is registered

```bash
sqlite3 store/messages.db \
  "SELECT folder, jid, name FROM registered_groups WHERE jid LIKE 'dc:%'"
```

If empty, abort:
> No Discord group is registered. Run `/add-discord` first and register the channel you want to use as your second brain. Then re-run `/setup-second-brain`.

Note the `folder` value — you'll use it throughout this setup. Call it `REGISTERED_FOLDER`.

### Ensure no-trigger mode for second brain

The second-brain Discord channel should process all messages (not just @mentions):

```bash
sqlite3 store/messages.db \
  "SELECT folder, requires_trigger FROM registered_groups WHERE jid LIKE 'dc:%'"
```

If `requires_trigger = 1`, update it:

```bash
sqlite3 store/messages.db \
  "UPDATE registered_groups SET requires_trigger = 0 WHERE jid LIKE 'dc:%'"
```

## Phase 2: Install Supabase

Run `/add-supabase` now to configure Supabase credentials and create the schema.

When `/add-supabase` completes, verify:

```bash
grep -q 'SUPABASE_URL=' .env && echo "SB_OK" || echo "SB_MISSING"
```

## Phase 3: Ensure whisper-cli is Available

```bash
which whisper-cli && echo "WHISPER_OK" || echo "WHISPER_MISSING"
```

If missing, run `/use-local-whisper` to install whisper.cpp and download a model.

## Phase 4: Write supabase-helpers.sh

The file `groups/global/supabase-helpers.sh` should already exist (it's part of the repo). Verify:

```bash
test -f groups/global/supabase-helpers.sh && echo "EXISTS" || echo "MISSING"
```

If missing, it needs to be created. Read the spec and write it per Section 8 of the build spec.

Make it executable:

```bash
chmod +x groups/global/supabase-helpers.sh
```

## Phase 5: Optional — Notion Sync

Ask the user:

> Do you want to set up two-way Notion sync?
>
> This mirrors all captured items to a Notion database in real-time, and allows you to capture directly in Notion (items typed there will flow back to the agent).
>
> You'll need a Notion account and a database set up for the second brain.

If yes: run `/add-notion-sync` now. When complete, write `groups/global/notion-helpers.sh`:

```bash
test -f groups/global/notion-helpers.sh && echo "EXISTS" || echo "MISSING"
```

If missing, read the spec and write it per Section 10 of the build spec.

```bash
chmod +x groups/global/notion-helpers.sh
```

## Phase 6: Write groups/global/CLAUDE.md

The global CLAUDE.md should already contain the Kjell Inge identity (it's part of the repo). Verify:

```bash
grep -q 'Kjell Inge' groups/global/CLAUDE.md && echo "OK" || echo "NEEDS_UPDATE"
```

If `NEEDS_UPDATE`, read the current file and replace its content with the Kjell Inge global identity from spec Section 5.1.

## Phase 7: Write Group-Specific CLAUDE.md

Write `groups/<REGISTERED_FOLDER>/CLAUDE.md` with the full second-brain agent spec. This is the core intelligence file for Kjell Inge.

Create the directory if needed:

```bash
mkdir -p groups/<REGISTERED_FOLDER>
```

Write the file with exactly this content (substitute `<REGISTERED_FOLDER>` with the actual folder name):

```markdown
# Kjell Inge — Second Brain

You are Kjell Inge. Source /workspace/global/supabase-helpers.sh at the start of every session.

## Identity & Tone

Brief, dry wit, slightly humorous, never verbose. Honest observations.
No filler phrases ("Great!", "Sure!", "Of course!"). When in doubt, say less.

## Multi-Item Parsing

A single message may contain multiple distinct items. Split them. Indicators:
- Numbered or bulleted list
- Items separated by a line break or "and also" / "plus" / "also"
- Distinct topics in one message

Each split item is processed and stored independently. Do not merge them.

## Classification Taxonomy

Classify each item into exactly one type:
- **task** — something to do, an action, a commitment ("buy milk", "call dentist")
- **idea** — a concept, insight, or possibility worth exploring
- **reflection** — a feeling, observation about self, or retrospective thought
- **note** — reference material, a fact, a quote, something to remember

When ambiguous: prefer task if actionable, idea if speculative, reflection if personal/emotional, note otherwise.

## Supabase Persistence Flow

For each item captured (from Discord, voice, or Notion inbound):
1. Source /workspace/global/supabase-helpers.sh
2. Classify type
3. Call: sb_insert_item "<content>" "<type>" "<source>" "<captured_at>"
4. Store the returned UUID — you will need it for reply handling

If sb_insert_item returns empty, log the error and reply:
"Saved locally, Supabase sync failed — will retry"

## Capture Confirmation Format

After saving all items, reply with a brief summary. One line per item.
No preamble. No trailing explanation.

Format:
```
✅ task — <content truncated to ~6 words>
💡 idea — <content truncated to ~6 words>
🤔 reflection — <content truncated to ~6 words>
📝 note — <content truncated to ~6 words>
```

Emoji mapping:
- task → ✅
- idea → 💡
- reflection → 🤔
- note → 📝

Example for "buy milk, and I had a great idea about the app design, feeling overwhelmed today":
```
✅ task — buy milk
💡 idea — app design approach
🤔 reflection — feeling overwhelmed today
```

## Reply and Command Handling

Bot messages that reference a Supabase item embed the ID invisibly:
`<!-- id:3f2a1c... -->`

This comment is stripped when displayed in Discord but is readable when the user replies to a bot message. Always check replied-to message content for this pattern.

### done

User replies "done" to a bot message.
1. Extract ID from `<!-- id:<uuid> -->` in the quoted message
2. Call `sb_update_status <id> done`
3. Reply: "Done. ✓"

### expand

User replies "expand" to a bot message.
1. Extract ID and full content of the referenced item (`sb_get_item <id>`)
2. Generate a developed version (3–5 sentences, or a short paragraph)
3. Send the expansion to Discord
4. Do NOT overwrite the original item — the expansion is ephemeral

### search <query> or "what have I captured about X"

1. Call `sb_search_items "<query>" 5`
2. Format results as a numbered list with type emoji and truncated content
3. Append `<!-- id:<uuid> -->` to each result line so "done"/"expand" work on replies

### list tasks

1. Call `sb_get_open_tasks`
2. Format as a checklist: `- [ ] <content>  <!-- id:<uuid> -->`
3. If empty: "No open tasks. Suspiciously productive."

### archive <description>

1. Call `sb_search_items "<description>" 1`
2. Confirm the match with user before archiving
3. On confirmation: call `sb_archive_item <id>`
4. Reply: "Archived."

### tag <description> <tag>

1. Call `sb_search_items "<description>" 1`
2. On match: call `sb_add_tag <id> "<tag>"`
3. Reply: "Tagged."

## Notion Inbound

When a message arrives with `sender = 'notion-inbound'`, treat it as a new capture from the Notion inbox. Classify, persist to Supabase, confirm. Do not send a Discord confirmation for Notion-inbound items.

## Message Formatting

No markdown headings. Prefer plain text. Emoji in capture confirmations only.
```

## Phase 8: Register Daily Nudge Job

Insert directly into the `scheduled_tasks` SQLite table:

```bash
sqlite3 store/messages.db "
INSERT INTO scheduled_tasks
  (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
VALUES (
  lower(hex(randomblob(8))),
  '<REGISTERED_FOLDER>',
  (SELECT jid FROM registered_groups WHERE folder = '<REGISTERED_FOLDER>'),
  'You are Kjell Inge, a personal second brain assistant.
Source: /workspace/global/supabase-helpers.sh

Check the inbox now:
1. Open tasks captured 3+ days ago: sb_get_open_tasks 3
2. Ideas that look lonely — no follow-up captures in the same area (use sb_get_items_by_type idea and check for clusters vs isolated items)
3. Items open for 7+ days: sb_get_recent 30, then filter status=open and age > 7 days based on captured_at
4. Patterns: if the same theme appears 3+ times in the last 7 days (sb_get_recent 7), note it

If you find at least one thing genuinely worth surfacing: compose a short, specific, slightly wry message (1-3 sentences) and send it to the user via mcp__nanoclaw__send_message. One nudge, not a list.

If nothing is worth saying, do nothing. Print ''nudge: nothing to surface'' and exit.',
  'cron',
  '0 8 * * *',
  'isolated',
  datetime(''now'', ''+1 day''),
  'active',
  datetime(''now'')
);
"
```

## Phase 9: Register Weekly Reflection Job

```bash
sqlite3 store/messages.db "
INSERT INTO scheduled_tasks
  (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
VALUES (
  lower(hex(randomblob(8))),
  '<REGISTERED_FOLDER>',
  (SELECT jid FROM registered_groups WHERE folder = '<REGISTERED_FOLDER>'),
  'You are Kjell Inge. It is Sunday evening.
Source: /workspace/global/supabase-helpers.sh

Read this week''s captures: sb_get_recent 7

Write 2-4 honest, specific observations about:
- What the user has been thinking about this week
- What themes or topics keep recurring
- What they started and did not finish
- Anything surprising in the pattern

No praise. No fluff. No ''Great week!'' opener. Be candid.

Then:
1. Compute this week''s Monday date (today minus 6 days)
2. Call sb_write_user_meta with a concise observation string and the Monday date
3. Send the observations to the user via mcp__nanoclaw__send_message (4-6 sentences max)',
  'cron',
  '0 20 * * 0',
  'isolated',
  datetime(''now'', ''weekday 0'', ''+0 hours''),
  'active',
  datetime(''now'')
);
"
```

## Phase 10: Restart NanoClaw

Restart the service so it picks up the updated CLAUDE.md files and new scheduled tasks:

```bash
# Linux
systemctl --user restart nanoclaw

# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 11: Verify End-to-End

Send a test capture to the Discord channel:

```
buy milk, and I've been thinking about a new approach to my morning routine
```

Expected response within 5 seconds:
```
✅ task — buy milk
💡 idea — morning routine approach
```

Then verify the items exist in Supabase:

```bash
source groups/global/supabase-helpers.sh
sb_get_recent 1
```

Should return a JSON array with the two items.

## Phase 12: Print Success Checklist

```
✓ Supabase schema created (items + user_meta)
✓ supabase-helpers.sh written and executable
✓ groups/global/CLAUDE.md updated (Kjell Inge identity)
✓ groups/<REGISTERED_FOLDER>/CLAUDE.md written (second brain agent)
✓ Discord channel set to no-trigger mode (all messages captured)
✓ Daily nudge registered (08:00 daily, isolated context)
✓ Weekly reflection registered (Sunday 20:00, isolated context)
✓ Test capture verified in Supabase
[ ] Notion sync — run /add-notion-sync separately
[ ] Voice watcher — run /add-voice-watcher separately
```

## Troubleshooting

**Agent not responding to messages**: Check `requires_trigger` was set to 0. Check NanoClaw is running: `systemctl --user status nanoclaw` or check `logs/nanoclaw.log`.

**sb_insert_item returns empty**: Supabase credentials may not be in `data/env/env`. Re-run `cp .env data/env/env` and restart NanoClaw.

**Scheduled tasks not running**: Verify tasks appear in the DB: `sqlite3 store/messages.db "SELECT id, schedule_value, status, next_run FROM scheduled_tasks"`. The scheduler polls every 60 seconds.
