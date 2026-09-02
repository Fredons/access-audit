/**
 * Prospect scanner.
 *
 * Fast pass over a list of domains to find sites running an accessibility overlay
 * widget. These are the warm segment: they have already paid for accessibility, the
 * overlay does not deliver conformance, and in the first half of 2025, 22.6% of US web
 * accessibility lawsuits were filed against sites that had one installed.
 *
 * Skips the axe scan entirely, so it is roughly 5x faster per site than audit.mjs.
 *
 * Usage:
 *   node prospect.mjs domains.txt            # one domain or URL per line
 *   node prospect.mjs domains.txt --concurrency 6
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OVERLAYS = [
  { name: 'accessiBe',  hosts: ['acsbapp.com', 'accessibe.com'],  globals: ['acsbJS', 'acsb', 'accessiBeWidget'] },
  { name: 'UserWay',    hosts: ['userway.org', 'userway.com'],    globals: ['UserWay', 'userwayWidgetApp'] },
  { name: 'AudioEye',   hosts: ['audioeye.com'],                  globals: ['__AudioEyeSettings', '_audioEyeQue', 'AudioEye'] },
  { name: 'EqualWeb',   hosts: ['equalweb.com', 'nagich.co.il'],  globals: ['INDWEB', 'eqwGlobal'] },
  { name: 'User1st',    hosts: ['user1st.info'],                  globals: ['u1st'] },
  { name: 'Recite Me',  hosts: ['reciteme.com'],                  globals: ['ReciteMe', '_rmReady'] },
];

// Platform hints tell us how hard remediation will be and who the buyer is.
const PLATFORMS = [
  { name: 'Shopify',     test: (h, html) => h.includes('cdn.shopify.com') || html.includes('Shopify.theme') },
  { name: 'WooCommerce', test: (h, html) => html.includes('woocommerce') || h.includes('/wp-content/plugins/woocommerce') },
  { name: 'WordPress',   test: (h, html) => h.includes('/wp-content/') || h.includes('/wp-includes/') },
  { name: 'BigCommerce', test: (h) => h.includes('bigcommerce.com') },
  { name: 'Magento',     test: (h, html) => html.includes('Magento') || h.includes('/static/version') },
  { name: 'Wix',         test: (h) => h.includes('parastorage.com') },
  { name: 'Squarespace', test: (h) => h.includes('squarespace.com') },
];

function normalise(line) {
  const t = line.trim();
  if (!t || t.startsWith('#')) return null;
  return t.startsWith('http') ? t : `https://${t}`;
}

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function checkSite(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);

    const scriptHosts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => s.src)
    );
    const hostBlob = scriptHosts.join(' ');
    const html = (await page.content()).slice(0, 200000);

    const overlays = [];
    for (const o of OVERLAYS) {
      const viaScript = o.hosts.some((h) => hostBlob.includes(h));
      const viaGlobal = await page.evaluate(
        (g) => g.some((k) => typeof window[k] !== 'undefined'),
        o.globals
      );
      if (viaScript || viaGlobal) overlays.push(o.name);
    }

    const platform = PLATFORMS.find((p) => p.test(hostBlob, html))?.name ?? 'unknown';
    const title = await page.title();

    await context.close();
    return { url, title, overlays, platform, ok: true };
  } catch (e) {
    await context.close();
    return { url, ok: false, error: e.message.split('\n')[0] };
  }
}

async function pool(items, size, worker) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
      const r = out[idx];
      process.stderr.write(
        `[${idx + 1}/${items.length}] ${r.ok ? (r.overlays.length ? `HIT ${r.overlays.join('/')}` : 'no overlay') : 'error'}  ${r.url}\n`
      );
    }
  });
  await Promise.all(runners);
  return out;
}

const listFile = process.argv[2];
if (!listFile) {
  console.error('Usage: node prospect.mjs <domains.txt> [--concurrency N]');
  process.exit(1);
}

const urls = readFileSync(listFile, 'utf8').split('\n').map(normalise).filter(Boolean);
const concurrency = Number(arg('--concurrency', 5));

const browser = await chromium.launch();
const results = await pool(urls, concurrency, (u) => checkSite(browser, u));
await browser.close();

const hits = results.filter((r) => r.ok && r.overlays.length);
const clean = results.filter((r) => r.ok && !r.overlays.length);
const failed = results.filter((r) => !r.ok);

const date = new Date().toISOString().slice(0, 10);
mkdirSync('prospects', { recursive: true });
const outfile = join('prospects', `${date}-scan.json`);
writeFileSync(outfile, JSON.stringify({ scannedAt: new Date().toISOString(), results }, null, 2));

const csv = [
  'url,title,overlay,platform',
  ...hits.map((h) => `"${h.url}","${(h.title || '').replace(/"/g, "'")}","${h.overlays.join('|')}","${h.platform}"`),
].join('\n');
writeFileSync(join('prospects', `${date}-overlay-hits.csv`), csv);

const byVendor = {};
for (const h of hits) for (const v of h.overlays) byVendor[v] = (byVendor[v] || 0) + 1;

console.log('');
console.log(`scanned:       ${results.length}`);
console.log(`overlay hits:  ${hits.length}  (${((hits.length / (results.length || 1)) * 100).toFixed(1)}%)`);
console.log(`no overlay:    ${clean.length}`);
console.log(`errors:        ${failed.length}`);
console.log(`by vendor:     ${Object.entries(byVendor).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
console.log(`output:        ${outfile} + overlay-hits.csv`);
