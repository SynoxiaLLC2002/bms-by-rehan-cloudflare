#!/usr/bin/env bash
# Creates or updates one BMS site on Cloudflare: its D1 database, R2 bucket, the
# admin Worker and the public Worker, with their secrets. Safe to run again —
# that is how a site is updated to a new BMS version.
#
# Runs in Linux (OpenNext does not fully support Windows): deploy.ps1 starts it
# in Docker with this folder at /app, the site secrets folder at /state and the
# Cloudflare sign-in kept in a Docker volume.
#
#   deploy.sh <site-name> [domain] [region]
#   e.g. deploy.sh my-site example.com enam
#
# region = where the database and files live, for a NEW site only (Cloudflare
# cannot move them later): enam (default, US East), wnam (US West), weur, eeur,
# apac, oc. Pick where the visitors are, not where this PC is: left to itself
# Cloudflare uses the creator's region, and a US site built from Asia then
# crosses the Pacific on every database call.
set -euo pipefail

SITE="${1:-}"
DOMAIN="${2:-}"
REGION="${BMS_REGION:-${3:-enam}}"
if [[ ! "$REGION" =~ ^(enam|wnam|weur|eeur|apac|oc)$ ]]; then
  echo "Region: one of enam, wnam, weur, eeur, apac, oc."
  exit 1
fi
if [[ ! "$SITE" =~ ^[a-z][a-z0-9-]{1,40}$ ]]; then
  echo "Site name: lowercase letters, numbers and dashes, starting with a letter (for example my-site)."
  exit 1
fi
if [[ -n "$DOMAIN" && ! "$DOMAIN" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
  echo "Domain: just the name, like example.com (no https://, no www)."
  exit 1
fi
cd /app
STATE="/state/$SITE.env"
# A site moved to another region keeps its names in its env file (DB_NAME, BUCKET_NAME).
DB_NAME="$SITE-db"; BUCKET_NAME="$SITE-media"
if [ -f "$STATE" ]; then set -a; . "$STATE"; set +a; fi
say() { echo; echo "==== $* ===="; }
rand() { node -e 'console.log(require("crypto").randomBytes(Number(process.argv[1])).toString("base64url"))' "$1"; }

say "1/7 Installing packages (first time only, a few minutes)"
[ -x node_modules/.bin/opennextjs-cloudflare ] || npm ci --no-audit --no-fund

say "2/7 Cloudflare sign-in"
if npx wrangler whoami 2>&1 | grep -qi "not authenticated"; then
  echo "Open the link below in your browser, sign in to Cloudflare and click Allow."
  npx wrangler login --browser=false --callback-host 0.0.0.0 --callback-port 8976
fi
npx wrangler whoami 2>&1 | grep -iE "logged in|email" | head -2

say "3/7 Database and file storage"
db_id() { npx wrangler d1 list --json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const x=JSON.parse(d).find(r=>r.name===process.argv[1]);console.log(x?x.uuid:"")})' "$DB_NAME"; }
DB_ID="$(db_id)"
if [ -z "$DB_ID" ]; then
  npx wrangler d1 create "$DB_NAME" --location "$REGION" >/dev/null
  DB_ID="$(db_id)"
fi
[ -n "$DB_ID" ] || { echo "Could not create the database $DB_NAME."; exit 1; }
echo "database: $DB_NAME"
npx wrangler r2 bucket create "$BUCKET_NAME" --location "$REGION" >/dev/null 2>&1 || true
echo "storage:  $BUCKET_NAME"

ROUTES=""
[ -n "$DOMAIN" ] && ROUTES="\"routes\": [{ \"pattern\": \"$DOMAIN\", \"custom_domain\": true }, { \"pattern\": \"www.$DOMAIN\", \"custom_domain\": true }],"
sed -e "s/__DB_NAME__/$DB_NAME/g" -e "s/__BUCKET__/$BUCKET_NAME/g" -e "s/__SITE__/$SITE/g" -e "s/__DB_ID__/$DB_ID/g" deploy/admin.wrangler.template.jsonc > wrangler.jsonc
sed -e "s/__DB_NAME__/$DB_NAME/g" -e "s/__BUCKET__/$BUCKET_NAME/g" -e "s/__SITE__/$SITE/g" -e "s/__DB_ID__/$DB_ID/g" -e "s|__ROUTES__|$ROUTES|" deploy/public.wrangler.template.jsonc > astro/wrangler.jsonc

say "4/7 Database tables"
yes | npx wrangler d1 migrations apply "$DB_NAME" --remote 2>&1 | grep -E "executed|No migrations|✅|rror" || true

say "5/7 Building and uploading the admin (about 5 minutes)"
npx opennextjs-cloudflare build > /tmp/admin-build.log 2>&1 || { tail -40 /tmp/admin-build.log; echo "Admin build failed."; exit 1; }
npx opennextjs-cloudflare deploy 2>&1 | grep -E "Uploaded|schedule|rror"

# The site's secrets: made once, kept in sites/<site>.env on this PC, applied on every run.
if [ ! -f "$STATE" ]; then
  {
    echo "AUTH_SECRET=$(rand 32)"
    echo "SETUP_TOKEN=$(rand 9)"
    echo "CRON_TOKEN=$(rand 24)"
    echo "BACKUP_TOKEN=$(rand 24)"
  } > "$STATE"
fi
set -a; . "$STATE"; set +a
node -e 'const e=process.env;console.log(JSON.stringify({AUTH_SECRET:e.AUTH_SECRET,SETUP_TOKEN:e.SETUP_TOKEN,CRON_TOKEN:e.CRON_TOKEN,BACKUP_TOKEN:e.BACKUP_TOKEN}))' > /tmp/admin-secrets.json
node -e 'console.log(JSON.stringify({AUTH_SECRET:process.env.AUTH_SECRET}))' > /tmp/public-secrets.json
npx wrangler secret bulk /tmp/admin-secrets.json --name "$SITE-admin" 2>&1 | grep -iE "success|rror" | head -2

say "6/7 Building and uploading the public site"
npx astro build --root astro > /tmp/public-build.log 2>&1 || { tail -40 /tmp/public-build.log; echo "Public site build failed."; exit 1; }
(cd astro && npx wrangler deploy 2>&1 | tee /tmp/public-deploy.log | grep -E "Uploaded|https://|rror")
# Signed share-image links (lib/ogSign) need the same secret on both Workers.
npx wrangler secret bulk /tmp/public-secrets.json --name "$SITE" 2>&1 | grep -iE "success|rror" | head -2
rm -f /tmp/admin-secrets.json /tmp/public-secrets.json

say "7/7 Done"
URL="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/public-deploy.log | head -1 || true)"
[ -n "$DOMAIN" ] && URL="https://$DOMAIN"
echo "Site:        $URL"
# The Site URL setting (canonical links, sitemaps, 2FA labels): the domain once one
# is connected; otherwise the workers.dev address, only if none is set yet.
if [ -n "$URL" ]; then
  if [ -n "$DOMAIN" ]; then
    SQL="INSERT INTO site_settings (\`key\`, value) VALUES ('site_url', '$URL') ON CONFLICT(\`key\`) DO UPDATE SET value = excluded.value"
  else
    SQL="INSERT INTO site_settings (\`key\`, value) VALUES ('site_url', '$URL') ON CONFLICT(\`key\`) DO NOTHING"
  fi
  npx wrangler d1 execute "$DB_NAME" --remote --command "$SQL" >/dev/null 2>&1 && echo "Site URL:    set to $URL" || echo "Site URL:    set it in Settings (could not write it)"
fi
if [ -n "$URL" ]; then node deploy/warm.mjs "$URL" 2>/dev/null || true; fi
echo "Admin:       $URL/admin/setup   (first time: create your account there)"
echo "Setup code:  $SETUP_TOKEN"
echo "Secrets are saved in sites/$SITE.env on this PC. Keep that file private and do not delete it."
