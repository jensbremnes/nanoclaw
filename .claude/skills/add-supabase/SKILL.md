---
name: add-supabase
description: Configure Supabase credentials and create the second-brain schema (items + user_meta tables).
---

# Add Supabase

Configures Supabase as the persistent store for the Kjell Inge second brain.

## Phase 1: Pre-flight

### Check if already configured

```bash
grep -q 'SUPABASE_URL=' .env 2>/dev/null && echo "ALREADY_SET" || echo "NOT_SET"
```

If `ALREADY_SET`, verify the credentials still work (Phase 3 validation) and skip to Phase 4 (schema).

## Phase 2: Collect Credentials

Use `AskUserQuestion` to collect both values at once:

> I need two values from your Supabase project settings (Settings → API):
>
> 1. **Project URL** — looks like `https://xxxxxxxxxxxx.supabase.co`
> 2. **Service role key** — under "Project API keys", use the `service_role` key (not the `anon` key)
>
> The service role key bypasses Row Level Security and is needed for server-side writes.

Wait for both values before continuing.

## Phase 3: Validate Credentials

```bash
SUPABASE_URL="<their-url>"
SUPABASE_KEY="<their-key>"

curl -sS -o /dev/null -w "%{http_code}" \
  "$SUPABASE_URL/rest/v1/" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

If the response is not `200`, the credentials are wrong. Ask the user to double-check them.

## Phase 4: Write to Environment

Append to `.env` (create if missing):

```bash
# Supabase — second brain
SUPABASE_URL=<their-url>
SUPABASE_SERVICE_KEY=<their-service-role-key>
```

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 5: Run Schema

Check if `psql` is available:

```bash
which psql && echo "PSQL_AVAILABLE" || echo "PSQL_MISSING"
```

### If psql is available

Ask the user:

> I need the PostgreSQL connection string from Supabase to create the database schema.
>
> 1. Go to your Supabase project → Settings → Database
> 2. Under "Connection string", select the **URI** tab
> 3. Use the **Session mode** string (port 5432) — it looks like:
>    `postgresql://postgres.xxxx:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
> 4. Replace `[YOUR-PASSWORD]` with your database password

Then run:

```bash
psql "<their-connection-string>" -f supabase/schema.sql
```

### If psql is not available

Tell the user:

> `psql` is not installed. Please run the schema manually:
>
> 1. Go to your Supabase project → SQL Editor
> 2. Copy the contents of `supabase/schema.sql` and paste it into the editor
> 3. Click **Run**
>
> Let me know when that's done.

Wait for confirmation.

## Phase 6: Verify Schema

```bash
curl -sS "$SUPABASE_URL/rest/v1/items?limit=1" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

Confirm the response is a JSON array (even if empty: `[]`). If it returns an error, the schema wasn't applied — check the SQL editor for errors.

Also verify `user_meta`:

```bash
curl -sS "$SUPABASE_URL/rest/v1/user_meta?limit=1" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY"
```

## Phase 7: Confirm

Tell the user:

> ✓ Supabase connected and schema verified.
> • URL: <their-url>
> • Tables: `items`, `user_meta`
> • Full-text search index ready
>
> Next step: run `/setup-second-brain` to complete the install.
