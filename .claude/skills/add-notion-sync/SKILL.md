---
name: add-notion-sync
description: Configure Notion two-way sync for the second brain (Supabase ↔ Notion database).
---

# Add Notion Sync

Sets up bidirectional sync between Supabase and a Notion database. Items captured via Discord or voice appear in Notion automatically. Items typed directly into Notion flow into Supabase and trigger the agent.

## Phase 1: Pre-flight

### Check prerequisites

```bash
# Supabase must be configured first
grep -q 'SUPABASE_URL=' .env 2>/dev/null && echo "SB_OK" || echo "SB_MISSING"

# notion-sync.ts must exist
test -f scripts/notion-sync.ts && echo "SCRIPT_OK" || echo "SCRIPT_MISSING"
```

If Supabase is not configured, abort and tell the user to run `/add-supabase` first.
If `notion-sync.ts` is missing, abort and tell the user to re-clone the repo.

### Check if already configured

```bash
grep -q 'NOTION_API_KEY=' .env 2>/dev/null && echo "ALREADY_SET" || echo "NOT_SET"
```

If already set, verify credentials (Phase 3) and skip to Phase 5 (service setup).

## Phase 2: Create a Notion Integration

Tell the user:

> To connect Notion, I need an integration token:
>
> 1. Go to https://www.notion.so/profile/integrations
> 2. Click **New integration**
> 3. Name it "Kjell Inge" and select your workspace
> 4. Under **Capabilities**, enable: Read content, Update content, Insert content
> 5. Click **Save** and copy the **Internal Integration Token** (starts with `ntn_` or `secret_`)
>
> Then, in Notion:
> 6. Open your Second Brain database page
> 7. Click the **⋯** menu → **Connect to** → select "Kjell Inge"
>
> Finally, copy the **Database ID** from the URL:
> `https://www.notion.so/<workspace>/<DATABASE_ID>?v=...`
> The database ID is the 32-character hex string before the `?`.

Wait for both the token and database ID.

## Phase 3: Validate Credentials

```bash
NOTION_KEY="<their-key>"
NOTION_DB="<their-database-id>"

curl -sS -o /dev/null -w "%{http_code}" \
  "https://api.notion.com/v1/databases/$NOTION_DB" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2022-06-28"
```

If not `200`, the credentials are wrong or the integration hasn't been connected to the database. Prompt the user to recheck Step 6 above.

## Phase 4: Write to Environment

Append to `.env`:

```bash
# Notion sync
NOTION_API_KEY=<their-key>
NOTION_DATABASE_ID=<their-database-id>
NOTION_SETUP_AFTER=<current-ISO-timestamp>
```

For `NOTION_SETUP_AFTER`, use the current UTC timestamp:

```bash
date -u +%Y-%m-%dT%H:%M:%S.000Z
```

This prevents pages that existed before setup from flooding the inbound sync.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 5: Verify Notion Database Properties

Check the database has the required properties. Retrieve the schema:

```bash
curl -sS "https://api.notion.com/v1/databases/$NOTION_DB" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2022-06-28" \
  | jq '.properties | keys'
```

Required properties: `Name` (title), `Full Content` (rich_text), `Type` (select), `Status` (select), `Tags` (multi_select), `Source` (select), `Supabase ID` (rich_text), `Notion ID` (rich_text), `Captured At` (date), `Synced At` (date).

For any missing property, create it via the Notion API:

```bash
curl -sS -X PATCH "https://api.notion.com/v1/databases/$NOTION_DB" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{
    "properties": {
      "Full Content": {"rich_text": {}},
      "Type": {"select": {"options": [
        {"name": "task", "color": "green"},
        {"name": "idea", "color": "blue"},
        {"name": "reflection", "color": "purple"},
        {"name": "note", "color": "gray"}
      ]}},
      "Status": {"select": {"options": [
        {"name": "open", "color": "yellow"},
        {"name": "done", "color": "green"},
        {"name": "archived", "color": "gray"}
      ]}},
      "Tags": {"multi_select": {}},
      "Source": {"select": {"options": [
        {"name": "discord", "color": "blue"},
        {"name": "voice", "color": "orange"},
        {"name": "notion", "color": "default"}
      ]}},
      "Supabase ID": {"rich_text": {}},
      "Captured At": {"date": {}},
      "Synced At": {"date": {}}
    }
  }'
```

## Phase 6: Set Up Systemd Timer (Linux)

Detect OS:

```bash
uname -s
```

### Linux — systemd user timer

Determine the project path:

```bash
pwd
```

Create `~/.config/systemd/user/nanoclaw-notion-sync.service`:

```ini
[Unit]
Description=NanoClaw Notion sync daemon
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=<project-path>
EnvironmentFile=<project-path>/data/env/env
ExecStart=/usr/bin/env npx tsx scripts/notion-sync.ts
StandardOutput=append:<project-path>/logs/notion-sync.log
StandardError=append:<project-path>/logs/notion-sync.log
```

Create `~/.config/systemd/user/nanoclaw-notion-sync.timer`:

```ini
[Unit]
Description=Run NanoClaw Notion sync every 2 minutes

[Timer]
OnBootSec=30s
OnUnitActiveSec=2min
AccuracySec=10s

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-notion-sync.timer
```

### macOS — launchd plist

Create `~/Library/LaunchAgents/com.nanoclaw.notion-sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nanoclaw.notion-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npx</string>
    <string>tsx</string>
    <string><project-path>/scripts/notion-sync.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string><project-path></string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StartInterval</key>
  <integer>120</integer>
  <key>StandardOutPath</key>
  <string><project-path>/logs/notion-sync.log</string>
  <key>StandardErrorPath</key>
  <string><project-path>/logs/notion-sync.log</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.notion-sync.plist
```

## Phase 7: Verify Service is Running

### Linux:

```bash
systemctl --user status nanoclaw-notion-sync.timer
journalctl --user -u nanoclaw-notion-sync -n 20
```

### macOS:

```bash
launchctl list | grep notion-sync
tail -20 <project-path>/logs/notion-sync.log
```

## Phase 8: End-to-End Test

Tell the user:

> Two tests to confirm sync is working:
>
> **Test A — outbound (Discord → Notion):**
> Send a message to your Discord second-brain channel. After the agent confirms it, wait up to 2 minutes and check your Notion database for the item.
>
> **Test B — inbound (Notion → Discord):**
> Create a new page in your Notion Second Brain database directly (type something in the Name field). Wait up to 2 minutes and check if Kjell Inge acknowledges it in Discord.

Confirm both work before finishing.

## Troubleshooting

**"No Supabase ID is written back to Notion"**: Check `logs/notion-errors.log` — the PATCH call may be failing because the integration isn't connected to the database.

**Items not appearing in Notion**: Check `logs/notion-sync.log`. Ensure the timer is firing: `systemctl --user list-timers | grep notion`.

**Inbound items creating duplicates**: The `NOTION_SETUP_AFTER` filter prevents this. Ensure it's set in `data/env/env`.
