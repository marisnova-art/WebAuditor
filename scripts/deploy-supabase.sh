#!/usr/bin/env bash
# One-time Supabase deployment for project ptnfwrzwpireodomidcj.
# Prereq: Supabase CLI (https://supabase.com/docs/guides/cli), then run from the project root:
#   bash scripts/deploy-supabase.sh
set -euo pipefail
PROJECT_REF=ptnfwrzwpireodomidcj

supabase login
[ -f supabase/config.toml.bak ] || cp supabase/config.toml supabase/config.toml.bak 2>/dev/null || true
supabase link --project-ref "$PROJECT_REF"

# Server-side secrets (never put these in index.html)
read -rp "AI engine (claude/openai/gemini/mock) [mock]: " ENGINE; ENGINE=${ENGINE:-mock}
KEY=""; if [ "$ENGINE" != "mock" ]; then read -rsp "AI API key: " KEY; echo; fi
read -rp "Site origin(s) allowed to call the function, comma-separated [*]: " ORIGINS; ORIGINS=${ORIGINS:-*}
supabase secrets set AI_ENGINE="$ENGINE" ${KEY:+AI_API_KEY="$KEY"} ANON_SALT="$(openssl rand -hex 16)" ALLOWED_ORIGINS="$ORIGINS"

supabase functions deploy audit --no-verify-jwt
echo "Done. Test: curl -i -X OPTIONS https://$PROJECT_REF.supabase.co/functions/v1/audit"
