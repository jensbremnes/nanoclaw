#!/usr/bin/env npx tsx
/**
 * voice-watcher.ts — HOST-SIDE voice memo watcher for Kjell Inge second brain
 *
 * Polls VOICE_MEMOS_PATH for new .m4a files, transcribes via whisper-cli,
 * and injects transcripts into NanoClaw's SQLite message queue.
 *
 * Runs as a host-side systemd service (never inside a NanoClaw container).
 * Requires: whisper-cli (brew install whisper-cpp), ffmpeg, ffprobe
 */

import Database from 'better-sqlite3';
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'store', 'messages.db');
const VOICE_MEMOS_PATH = process.env.VOICE_MEMOS_PATH
  ? process.env.VOICE_MEMOS_PATH.replace(/^~/, process.env.HOME ?? '')
  : path.join(process.env.HOME ?? '', 'Dropbox', 'Voice Memos');
const WHISPER_MODEL = process.env.WHISPER_MODEL
  ? process.env.WHISPER_MODEL.replace(/^~/, process.env.HOME ?? '')
  : path.join(PROJECT_ROOT, 'data', 'models', 'ggml-base.bin');
const WHISPER_BIN = process.env.WHISPER_BIN ?? 'whisper-cli';
const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function getRegisteredFolder(): string {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare("SELECT folder FROM registered_groups WHERE jid LIKE 'dc:%' LIMIT 1")
      .get() as { folder: string } | undefined;
    if (!row) throw new Error('No Discord group registered. Run /add-discord and /setup-second-brain first.');
    return row.folder;
  } finally {
    db.close();
  }
}

const REGISTERED_FOLDER = getRegisteredFolder();
const STATE_FILE = path.join(PROJECT_ROOT, 'groups', REGISTERED_FOLDER, 'voice-watcher-state.json');

type WatcherState = { processed: string[] };

function loadState(): WatcherState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw) as WatcherState;
  } catch {
    return { processed: [] };
  }
}

function saveState(state: WatcherState): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// SQLite helpers
// ---------------------------------------------------------------------------

function getChatJid(): string {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .prepare("SELECT jid FROM registered_groups WHERE folder = ?")
      .get(REGISTERED_FOLDER) as { jid: string } | undefined;
    if (!row) throw new Error(`No registered group with folder "${REGISTERED_FOLDER}"`);
    return row.jid;
  } finally {
    db.close();
  }
}

function injectMessage(transcript: string, chatJid: string): void {
  const db = new Database(DB_PATH);
  try {
    // Ensure chat row exists
    db.prepare(`
      INSERT OR IGNORE INTO chats (jid, name, last_message_time, channel, is_group)
      VALUES (?, 'Second Brain Voice', datetime('now'), 'discord', 0)
    `).run(chatJid);

    // Inject the transcript as an inbound message
    const id = randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO messages
        (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
      VALUES (?, ?, 'voice-watcher', 'Voice Memo', ?, datetime('now'), 0, 0)
    `).run(id, chatJid, transcript);

    console.log(`[voice-watcher] Injected: ${transcript.slice(0, 80)}...`);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

function getDurationSeconds(filePath: string): number {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration',
       '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { encoding: 'utf8', timeout: 10_000 }
    ).trim();
    return parseFloat(out) || 0;
  } catch {
    return 0;
  }
}

function transcribe(filePath: string): string {
  const duration = getDurationSeconds(filePath);
  if (duration < 1) {
    console.log(`[voice-watcher] Skipping ${path.basename(filePath)} (${duration.toFixed(2)}s < 1s)`);
    return '';
  }

  const wavOut = `/tmp/vw_${randomBytes(8).toString('hex')}.wav`;
  const txtOut = `/tmp/vw_${randomBytes(8).toString('hex')}`;

  try {
    // Convert to 16kHz mono WAV for whisper
    execFileSync('ffmpeg', [
      '-y', '-i', filePath,
      '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
      wavOut
    ], { stdio: 'pipe', timeout: 120_000 });

    execFileSync(WHISPER_BIN, [
      '-m', WHISPER_MODEL,
      '-f', wavOut,
      '--no-timestamps',
      '-nt',
      '-of', txtOut,
      '-l', 'en'
    ], { stdio: 'pipe', timeout: 300_000 });

    const txtFile = `${txtOut}.txt`;
    if (!fs.existsSync(txtFile)) return '';

    const raw = fs.readFileSync(txtFile, 'utf8');
    fs.unlinkSync(txtFile);

    return raw
      .replace(/\[BLANK_AUDIO\]/gi, '')
      .replace(/\n/g, ' ')
      .trim();
  } catch (err) {
    console.error(`[voice-watcher] Transcription failed for ${path.basename(filePath)}:`, err);
    // Don't inject a failed transcription — log and skip
    return '';
  } finally {
    try { fs.unlinkSync(wavOut); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Main poll loop
// ---------------------------------------------------------------------------

async function poll(): Promise<void> {
  if (!fs.existsSync(VOICE_MEMOS_PATH)) {
    console.warn(`[voice-watcher] VOICE_MEMOS_PATH not found: ${VOICE_MEMOS_PATH}`);
    return;
  }

  const state = loadState();
  const processedSet = new Set(state.processed);

  let files: string[];
  try {
    files = fs.readdirSync(VOICE_MEMOS_PATH)
      .filter(f => f.toLowerCase().endsWith('.m4a'));
  } catch (err) {
    console.error('[voice-watcher] Failed to read voice memos directory:', err);
    return;
  }

  const newFiles = files.filter(f => !processedSet.has(f));
  if (newFiles.length === 0) return;

  const chatJid = getChatJid();

  for (const filename of newFiles) {
    const fullPath = path.join(VOICE_MEMOS_PATH, filename);
    console.log(`[voice-watcher] Processing: ${filename}`);

    const transcript = transcribe(fullPath);

    if (transcript) {
      injectMessage(transcript, chatJid);
    } else {
      console.log(`[voice-watcher] Empty transcript for ${filename} — skipping`);
    }

    // Mark as processed regardless (even silently discarded clips)
    processedSet.add(filename);
    state.processed = Array.from(processedSet);
    saveState(state);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

console.log(`[voice-watcher] Starting — watching ${VOICE_MEMOS_PATH}`);
console.log(`[voice-watcher] Group folder: ${REGISTERED_FOLDER}`);
console.log(`[voice-watcher] Whisper model: ${WHISPER_MODEL}`);

// Run immediately, then on interval
(async () => {
  await poll();
  setInterval(() => {
    poll().catch(err => console.error('[voice-watcher] Poll error:', err));
  }, POLL_INTERVAL_MS);
})();
