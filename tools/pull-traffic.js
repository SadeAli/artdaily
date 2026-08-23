#!/usr/bin/env node
/* Pulls the zone's traffic numbers from Cloudflare's GraphQL Analytics API and
   upserts them into data/traffic.csv — the counter of record.

   WHY THIS EXISTS: `httpRequestsAdaptiveGroups` retains only ~7 DAYS on the free
   plan. The dashboards are a window, not a record; this CSV is the only long-term
   record of the six-month target window that will exist. Miss a week and that
   week is gone permanently. GROWTH.md (workspace root) holds the metric
   definition and the readings log.

   WHAT IT MEASURES — GROWTH.md's canonical Visits definition:
     "a visit is one successful HTML document request to artdaily.sadeali.com
      whose referring host is not artdaily.sadeali.com, with bot-classified
      requests excluded"
   The `visits` column is Cloudflare's own sum(visits) over successful (2xx) HTML
   requests to this host — Cloudflare's Visits metric already embeds the
   "referring host is not this host" rule. ONE HONEST GAP: the free-plan GraphQL
   dataset exposes no bot classification, so bot-classified requests are NOT
   excluded here. Treat `visits` as an UPPER BOUND and say so in every report;
   the Web Analytics (RUM beacon) dashboard figure is the closer match to the
   definition because bots do not execute the beacon.

   SETUP (once — the token step needs the Cloudflare login, so the user does it):
     1. https://dash.cloudflare.com/profile/api-tokens → Create Token →
        Custom token → Get started.
        Name: sadeali-analytics-readonly
        Permissions: Zone · Analytics · Read   (nothing else)
        Zone Resources: Include · Specific zone · sadeali.com
        Continue to summary → Create Token → copy it (shown exactly once).
     2. Zone ID: dash.cloudflare.com → sadeali.com → Overview → right-hand
        column, "API" box → Zone ID → copy.
     3. Store both OUTSIDE the repo so they can never be committed:
          mkdir -p ~/.config/sadeali
          printf 'CF_ZONE_ID=<zone-id>\nCF_ANALYTICS_TOKEN=<token>\n' \
            > ~/.config/sadeali/cloudflare-analytics.env
          chmod 600 ~/.config/sadeali/cloudflare-analytics.env
     4. Twice-daily cron (GROWTH.md's mandated schedule; self-heals a missed run
        because every run re-pulls the whole 7-day retention window):
          crontab -e   and add:
          10 6,18 * * * /usr/bin/node /home/ali/sadeali.com/subdomains/artdaily/tools/pull-traffic.js >> /home/ali/.local/state/sadeali/pull-traffic.log 2>&1
        (first:  mkdir -p /home/ali/.local/state/sadeali)

     node tools/pull-traffic.js            # pull last 7 UTC days, upsert the CSV
     node tools/pull-traffic.js --dry-run  # print what would be written, touch nothing

   CSV semantics: one row per UTC date. Rows inside the retention window are
   REPLACED on every run (today's row is partial until the day ends; Cloudflare
   also delays free-plan metrics ~24h, so yesterday firms up over a day). Rows
   older than the window are never touched — they are the record. Never report a
   number this script did not pull; if the API errors, it exits non-zero and
   writes nothing.
*/
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

const HOST = 'artdaily.sadeali.com';
const API = 'https://api.cloudflare.com/client/v4/graphql';
const CSV = path.join(__dirname, '..', 'data', 'traffic.csv');
const HEADER = 'date,visits,html_2xx_requests,all_requests,bot_excluded,source,pulled_at_utc';
const SOURCE = 'cf-graphql:httpRequestsAdaptiveGroups';
const RETENTION_DAYS = 7; // free-plan retention; every run re-pulls the whole window
const DRY = process.argv.includes('--dry-run');

// ---- credentials: env vars first, then the git-proof file outside the repo ----
function loadCreds() {
  let zone = process.env.CF_ZONE_ID, token = process.env.CF_ANALYTICS_TOKEN;
  const envFile = path.join(os.homedir(), '.config', 'sadeali', 'cloudflare-analytics.env');
  if ((!zone || !token) && fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*(CF_ZONE_ID|CF_ANALYTICS_TOKEN)\s*=\s*(\S+)\s*$/);
      if (m) { if (m[1] === 'CF_ZONE_ID' && !zone) zone = m[2]; if (m[1] === 'CF_ANALYTICS_TOKEN' && !token) token = m[2]; }
    }
  }
  if (!zone || !token) {
    console.error(
      'No credentials. Set CF_ZONE_ID and CF_ANALYTICS_TOKEN, or create\n' +
      `  ${envFile}\n` +
      'with those two lines (see the setup steps in this file\'s header).\n' +
      'The token is a READ-ONLY Zone Analytics token — never commit it anywhere.');
    process.exit(1);
  }
  return { zone, token };
}

function utcDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400e3);
  return d.toISOString().slice(0, 10);
}

async function pullDay(creds, date) {
  // Aliases: one request per day (retention has a ~24h max query span, so we
  // never span dates). No `dimensions` block → one aggregate group per alias.
  const query = `{
    viewer { zones(filter: { zoneTag: "${creds.zone}" }) {
      html: httpRequestsAdaptiveGroups(limit: 1, filter: {
        date: "${date}",
        clientRequestHTTPHost: "${HOST}",
        edgeResponseContentTypeName: "html",
        edgeResponseStatus_geq: 200, edgeResponseStatus_leq: 299
      }) { sum { visits } count }
      all: httpRequestsAdaptiveGroups(limit: 1, filter: {
        date: "${date}",
        clientRequestHTTPHost: "${HOST}"
      }) { count }
    } }
  }`;
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || (body.errors && body.errors.length)) {
    // Print errors verbatim — if a field name is rejected, fix the query against
    // the live schema; never paper over it and never invent a number.
    throw new Error(`GraphQL error for ${date} (HTTP ${res.status}): ${JSON.stringify(body && body.errors || body)}`);
  }
  const z = body.data.viewer.zones[0];
  if (!z) throw new Error(`Zone ${creds.zone} not visible to this token — check the token's Zone Resources.`);
  const html = z.html[0] || { sum: { visits: 0 }, count: 0 };
  const all = z.all[0] || { count: 0 };
  return { date, visits: html.sum.visits, html2xx: html.count, allReq: all.count };
}

async function main() {
  const creds = loadCreds();
  const pulledAt = new Date().toISOString();
  const days = [];
  for (let i = RETENTION_DAYS - 1; i >= 0; i--) days.push(utcDate(i));

  const fresh = [];
  for (const date of days) fresh.push(await pullDay(creds, date));

  // Upsert: keep every existing row whose date we did not just re-pull.
  const kept = new Map();
  if (fs.existsSync(CSV)) {
    const lines = fs.readFileSync(CSV, 'utf8').trim().split('\n');
    if (lines[0] && lines[0] !== HEADER) {
      throw new Error(`data/traffic.csv header changed — expected:\n  ${HEADER}\ngot:\n  ${lines[0]}\nRefusing to guess; fix the file or this script.`);
    }
    for (const line of lines.slice(1)) {
      const date = line.split(',')[0];
      if (date) kept.set(date, line);
    }
  }
  for (const r of fresh) {
    kept.set(r.date, [r.date, r.visits, r.html2xx, r.allReq, 'no', SOURCE, pulledAt].join(','));
  }
  const out = [HEADER, ...[...kept.keys()].sort().map(d => kept.get(d))].join('\n') + '\n';

  if (DRY) { process.stdout.write(out); console.error('\n--dry-run: nothing written'); return; }
  fs.mkdirSync(path.dirname(CSV), { recursive: true });
  fs.writeFileSync(CSV, out);
  console.log(`${pulledAt} upserted ${fresh.length} day(s) into ${CSV}; visits (bots NOT excluded — upper bound): ` +
    fresh.map(r => `${r.date}=${r.visits}`).join(' '));
}

main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
