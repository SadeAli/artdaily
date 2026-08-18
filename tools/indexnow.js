#!/usr/bin/env node
/* Tells Bing, Yandex, Seznam and Naver about these URLs the moment they change,
   instead of waiting to be crawled. IndexNow is a push protocol: one POST with a
   URL list, verified by a key file served from the same host.

   Google does NOT participate — it has its own sitemap + Search Console flow, which
   is already wired up. This covers everyone else, and for a niche site the
   non-Google share of "free drawing exercises" traffic is not a rounding error.

   The key lives in 65990d4c1fcf31c3570047a30b2023a8.txt at the site root and must stay there: the API
   fetches it to prove whoever is submitting controls the host. Deleting that file
   silently turns every future submission into a rejection.

     node tools/indexnow.js            # submit every URL in sitemap.xml
     node tools/indexnow.js --dry-run  # print what would be sent
*/
const fs = require('fs'), https = require('https');

const KEY = '65990d4c1fcf31c3570047a30b2023a8';
const HOST = 'artdaily.sadeali.com';
const urls = [...fs.readFileSync('sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);

if (!urls.length) { console.error('sitemap.xml has no URLs — run tools/build-sitemap.js first'); process.exit(1); }

const payload = JSON.stringify({
  host: HOST,
  key: KEY,
  keyLocation: `https://${HOST}/${KEY}.txt`,
  urlList: urls,
});

if (process.argv.includes('--dry-run')) {
  console.log(payload.slice(0, 400) + '…');
  console.log(`\n${urls.length} URLs would be submitted`);
  process.exit(0);
}

const req = https.request({
  hostname: 'api.indexnow.org', path: '/IndexNow', method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) },
}, res => {
  /* 200 accepted · 202 accepted, key validation pending · 403 key file not reachable
     · 422 URLs do not match the host · 429 too many submissions. */
  let body = '';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log(`${res.statusCode} ${res.statusMessage} — ${urls.length} URLs submitted`);
    if (body.trim()) console.log(body.trim());
    if (res.statusCode >= 400) process.exitCode = 1;
  });
});
req.on('error', e => { console.error('submission failed:', e.message); process.exitCode = 1; });
req.write(payload);
req.end();
