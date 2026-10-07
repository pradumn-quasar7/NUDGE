#!/usr/bin/env bash
# Local Supabase-like stack without Docker:
#   throwaway Postgres cluster (dev/local-supabase/.data) + Supabase stubs
#   + supabase/migrations/*.sql + supabase/seed.sql
#   + PostgREST behind a tiny gateway on http://127.0.0.1:54321 (/rest/v1, /auth/v1 stub)
# Every run starts from a fresh database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA="$HERE/.data"

DB_PORT="${NUDGE_DB_PORT:-54322}"
API_PORT="${NUDGE_API_PORT:-54321}"
PGRST_PORT="${NUDGE_PGRST_PORT:-54331}"
export NUDGE_DB_PORT="$DB_PORT" NUDGE_API_PORT="$API_PORT" NUDGE_PGRST_PORT="$PGRST_PORT"
JWT_SECRET="${NUDGE_JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
export NUDGE_JWT_SECRET="$JWT_SECRET"
# Password for the seeded demo accounts (local only).
DEMO_PASSWORD="${NUDGE_DEMO_PASSWORD:-nudge-local-dev}"

find_bin() { command -v "$1" 2>/dev/null || { [[ -x "/opt/homebrew/bin/$1" ]] && echo "/opt/homebrew/bin/$1"; } || true; }
INITDB="$(find_bin initdb)"; PG_CTL="$(find_bin pg_ctl)"; PSQL_BIN="$(find_bin psql)"; POSTGREST="$(find_bin postgrest)"; NODE="$(find_bin node)"
for b in INITDB PG_CTL PSQL_BIN POSTGREST NODE; do
  if [[ -z "${!b}" ]]; then
    echo "missing dependency: $b (brew install postgresql@16 postgrest node)" >&2
    exit 1
  fi
done
export PSQL="$PSQL_BIN"

echo "▸ stopping any previous harness"
"$HERE/stop.sh" >/dev/null 2>&1 || true
if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1 || lsof -nP -iTCP:"$DB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $API_PORT or $DB_PORT is in use (is \`supabase start\` running?). Stop it or set NUDGE_API_PORT / NUDGE_DB_PORT." >&2
  exit 1
fi
rm -rf "$DATA"
mkdir -p "$DATA"

echo "▸ initdb ($DATA/pg)"
"$INITDB" -D "$DATA/pg" -U postgres --auth=trust -E UTF8 --locale=C >"$DATA/initdb.log"
LC_ALL=C "$PG_CTL" -D "$DATA/pg" -l "$DATA/postgres.log" -w \
  -o "-p $DB_PORT -k $DATA -c listen_addresses=127.0.0.1 -c timezone=UTC -c wal_level=logical" start >/dev/null

PSQL_ARGS=(-X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres)
run_sql() { "$PSQL_BIN" "${PSQL_ARGS[@]}" "$@"; }

echo "▸ Supabase stubs (roles, auth, storage, vault, pg_net, realtime publication)"
run_sql -f "$HERE/bootstrap.sql" >>"$DATA/migrate.log" 2>&1 || { cat "$DATA/migrate.log" >&2; exit 1; }

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "▸ migration $(basename "$f")"
  run_sql -f "$f" >>"$DATA/migrate.log" 2>&1 || { tail -n 30 "$DATA/migrate.log" >&2; exit 1; }
done

echo "▸ seed.sql"
run_sql -f "$ROOT/supabase/seed.sql" >>"$DATA/migrate.log" 2>&1 || { tail -n 30 "$DATA/migrate.log" >&2; exit 1; }

ANON_KEY="$("$NODE" "$HERE/mint-jwt.mjs" --role anon)"
SERVICE_ROLE_KEY="$("$NODE" "$HERE/mint-jwt.mjs" --role service_role)"

echo "▸ vault secrets (project_url, service_role_key) — after the seed, so seeded notes are not enqueued"
run_sql -v url="http://127.0.0.1:$API_PORT" -v key="$SERVICE_ROLE_KEY" >>"$DATA/migrate.log" 2>&1 <<'SQL'
select vault.create_secret(:'url', 'project_url');
select vault.create_secret(:'key', 'service_role_key');
SQL

echo "▸ demo accounts (confirmed; on_auth_user_created links the seeded memberships)"
run_sql -v pw="$DEMO_PASSWORD" >>"$DATA/migrate.log" 2>&1 <<'SQL'
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001', 'alex@brightline.in', crypt(:'pw', gen_salt('bf')), now(), '{"full_name":"Alex Fernandes"}'),
  ('a1000000-0000-4000-8000-000000000002', 'sana@brightline.in', crypt(:'pw', gen_salt('bf')), now(), '{"full_name":"Sana Qureshi"}'),
  ('a1000000-0000-4000-8000-000000000003', 'ravi@brightline.in', crypt(:'pw', gen_salt('bf')), now(), '{"full_name":"Ravi Patel"}');
SQL
linked="$(run_sql -A -t -c "select count(*) from public.organization_members where user_id is not null and status = 'active'")"
if [[ "$linked" != "3" ]]; then
  echo "expected 3 linked memberships, got $linked" >&2
  exit 1
fi

cat >"$DATA/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@127.0.0.1:$DB_PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-extra-search-path = "public, extensions"
db-max-rows = 1000
db-pool = 10
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
log-level = "warn"
CONF

echo "▸ PostgREST :$PGRST_PORT"
nohup "$POSTGREST" "$DATA/postgrest.conf" >"$DATA/postgrest.log" 2>&1 &
echo $! >"$DATA/postgrest.pid"

echo "▸ gateway :$API_PORT"
nohup "$NODE" "$HERE/gateway.mjs" >"$DATA/gateway.log" 2>&1 &
echo $! >"$DATA/gateway.pid"

for _ in $(seq 1 50); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/rest/v1/" -H "Authorization: Bearer $ANON_KEY" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ -z "${ready:-}" ]]; then
  echo "PostgREST did not come up; see $DATA/postgrest.log and $DATA/gateway.log" >&2
  tail -n 20 "$DATA/postgrest.log" >&2 || true
  exit 1
fi

cat >"$DATA/env" <<ENV
NUDGE_API_URL=http://127.0.0.1:$API_PORT
NUDGE_DB_URL=postgres://postgres@127.0.0.1:$DB_PORT/postgres
NUDGE_ANON_KEY=$ANON_KEY
NUDGE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
NUDGE_JWT_SECRET=$JWT_SECRET
NUDGE_DEMO_PASSWORD=$DEMO_PASSWORD
ENV

cat <<DONE

Nudge local stack is up.
  API         http://127.0.0.1:$API_PORT   (/rest/v1 → PostgREST, /auth/v1 stub, /functions/v1 → 501)
  Postgres    postgres://postgres@127.0.0.1:$DB_PORT/postgres   (psql -h 127.0.0.1 -p $DB_PORT -U postgres)
  anon key    $ANON_KEY
  keys + URLs are also in dev/local-supabase/.data/env

Tokens:
  node dev/local-supabase/mint-jwt.mjs --email alex@brightline.in   # owner (also sana@, ravi@)
  node dev/local-supabase/mint-jwt.mjs <auth-user-uuid>
  node dev/local-supabase/mint-jwt.mjs --role service_role
Demo accounts can also sign in through supabase-js (password in dev/local-supabase/README.md).

pg_net calls (ai-extract / followup-scheduler) are recorded, not sent:
  psql -h 127.0.0.1 -p $DB_PORT -U postgres -c 'select id, url, body from net.http_calls order by id'

Smoke test:  node dev/local-supabase/smoke.mjs        Stop:  dev/local-supabase/stop.sh [--clean]
DONE
