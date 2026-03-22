---
name: add-voice-watcher
description: Set up iPhone voice memo ingestion via Dropbox. Transcribes with whisper-cli and injects into the second brain.
---

# Add Voice Watcher

Watches a Dropbox folder for new iPhone voice memos, transcribes them locally with whisper.cpp, and injects them into NanoClaw's SQLite queue so the agent captures them as second-brain items.

**Prerequisite:** A Discord group must be registered (`/add-discord` completed and group registered).

## Phase 1: Pre-flight

### Check whisper-cli

```bash
which whisper-cli && echo "WHISPER_OK" || echo "WHISPER_MISSING"
```

If missing:

```bash
# Linux — build from source or use package manager
# macOS
brew install whisper-cpp
```

If whisper-cli is still unavailable after install, abort with:
> `whisper-cli` not found. Install it with `brew install whisper-cpp` (macOS) or build from source on Linux. Then re-run `/add-voice-watcher`.

### Check ffmpeg and ffprobe

```bash
which ffmpeg && which ffprobe && echo "FFMPEG_OK" || echo "FFMPEG_MISSING"
```

If missing:
```bash
# macOS
brew install ffmpeg
# Linux (Debian/Ubuntu)
sudo apt-get install -y ffmpeg
```

### Check whisper model

```bash
ls data/models/ggml-*.bin 2>/dev/null && echo "MODEL_OK" || echo "MODEL_MISSING"
```

If missing, download the base English model (~148MB):

```bash
mkdir -p data/models
curl -L -o data/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

### Check Discord group registered

```bash
sqlite3 store/messages.db "SELECT folder, jid FROM registered_groups WHERE jid LIKE 'dc:%'"
```

If empty, abort:
> No Discord group is registered. Run `/add-discord` and register a channel first, then come back.

### Check voice-watcher.ts exists

```bash
test -f scripts/voice-watcher.ts && echo "OK" || echo "MISSING"
```

If missing, abort and tell the user to re-clone the repository.

## Phase 2: Configure

Ask the user:

> Where does Dropbox sync your iPhone voice memos?
>
> Default: `~/Dropbox/Voice Memos`
>
> (In the iOS Voice Memos app, go to Settings → Dropbox to confirm the folder name.)

Wait for the path. Verify it exists:

```bash
ls "<their-path>" | head -5
```

If the directory doesn't exist yet, warn:
> That folder doesn't exist yet — it will be created automatically once Dropbox syncs a voice memo. The watcher will start correctly once it appears.

## Phase 3: Write Environment

Append to `.env`:

```bash
VOICE_MEMOS_PATH=<their-path>
WHISPER_MODEL=<project-path>/data/models/ggml-base.bin
WHISPER_BIN=whisper-cli
```

Sync to container environment (also read by systemd service):

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 4: Set Up Systemd Service (Linux)

Determine the project path:

```bash
pwd
```

Create `~/.config/systemd/user/nanoclaw-voice-watcher.service`:

```ini
[Unit]
Description=NanoClaw voice memo watcher
After=network.target

[Service]
Type=simple
WorkingDirectory=<project-path>
EnvironmentFile=<project-path>/data/env/env
ExecStart=/usr/bin/env npx tsx scripts/voice-watcher.ts
Restart=always
RestartSec=30
StandardOutput=append:<project-path>/logs/voice-watcher.log
StandardError=append:<project-path>/logs/voice-watcher.log

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now nanoclaw-voice-watcher.service
```

### macOS — launchd plist

Create `~/Library/LaunchAgents/com.nanoclaw.voice-watcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.nanoclaw.voice-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/npx</string>
    <string>tsx</string>
    <string><project-path>/scripts/voice-watcher.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string><project-path></string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>VOICE_MEMOS_PATH</key>
    <string><their-path></string>
    <key>WHISPER_MODEL</key>
    <string><project-path>/data/models/ggml-base.bin</string>
    <key>WHISPER_BIN</key>
    <string>whisper-cli</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string><project-path>/logs/voice-watcher.log</string>
  <key>StandardErrorPath</key>
  <string><project-path>/logs/voice-watcher.log</string>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load:

```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.voice-watcher.plist
```

## Phase 5: Verify Service

### Linux:

```bash
systemctl --user status nanoclaw-voice-watcher
tail -20 <project-path>/logs/voice-watcher.log
```

### macOS:

```bash
launchctl list | grep voice-watcher
tail -20 <project-path>/logs/voice-watcher.log
```

Look for the startup line:
`[voice-watcher] Starting — watching <path>`

## Phase 6: End-to-End Test

Tell the user:

> Record a short voice memo on your iPhone (say "test: this is a voice memo test"). The iOS Voice Memos app should sync it to Dropbox automatically — this can take 30–60 seconds depending on your Dropbox sync speed.
>
> Once synced, the watcher will pick it up within 30 seconds and Kjell Inge should reply in Discord with a capture confirmation.
>
> Let me know when you've recorded it and I'll watch the logs.

Monitor:

```bash
tail -f <project-path>/logs/voice-watcher.log
```

Look for `Injected:` within 60 seconds of Dropbox sync completing.

## Troubleshooting

**"whisper-cli: command not found" in logs but works in terminal**: The systemd service uses a restricted PATH. Add `/opt/homebrew/bin` (macOS) or the whisper-cli install path to the `ExecStart` line as a full path, or prepend it to `PATH` in the service file.

**Transcription is empty**: Test manually:
```bash
ffmpeg -i "<file.m4a>" -ar 16000 -ac 1 -c:a pcm_s16le /tmp/test.wav -y
whisper-cli -m data/models/ggml-base.bin -f /tmp/test.wav --no-timestamps -nt
```

**Files not detected**: Check `VOICE_MEMOS_PATH` — it must point to the folder containing `.m4a` files, not a parent folder. Check Dropbox sync is enabled for Voice Memos.

**State file**: Processed files are tracked in `groups/<registered-folder>/voice-watcher-state.json`. To re-process a file, remove its filename from that list.
