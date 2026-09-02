/**
 * Supabase credential exposure scanner.
 *
 * Loads a page, collects the JavaScript that page serves to every visitor, and looks for
 * Supabase credentials that should never reach the client.
 *
 * THE ONLY THING THIS TOOL DOES IS READ AND DECODE.
 *
 * A Supabase legacy key is a JWT: three base64url segments, unencrypted, with a `role`
 * claim in the payload. The token declares its own privilege level. So a dangerous key can
 * be told apart from a harmless one by decoding a string the site is already publishing,
 * with no request to the project's API and no authentication attempt of any kind.
 *
 * This tool never connects to any Supabase instance, never sends a discovered key
 * anywhere, and never tests whether a key works. Doing so would be unauthorised access to
 * someone else's database regardless of how carelessly the key was exposed. Detection is
 * observation. Use is intrusion. This file stays firmly on the observation side, and any
 * change to that is a change to the legality of running it.
 *
 * Usage:
 *   node supabase-scan.mjs https://example.com
 *   node supabase-scan.mjs https://a.com https://b.com --name "My sites"
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Supabase project URL, e.g. https://abcdefghijklmnopqrst.supabase.co
const SUPABASE_URL = /https?:\/\/([a-z0-9]{15,30})\.supabase\.(?:co|in)/gi;

// A JWT: header.payload.signature, all base64url.
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

// Supabase's newer key format (2025+). The prefix alone tells you the privilege level,
// so a secret key needs no decoding to classify.
const NEW_KEYS = [
  { name: 'Supabase secret key (new format)', re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g, critical: true },
  { name: 'Supabase publishable key (new format)', re: /\bsb_publishable_[A-Za-z0-9_-]{20,}\b/g, critical: false },
];

// Other credential shapes worth reporting if they turn up in client code. Same passive
// read, no validation against any provider.
//
// `critical` here means the credential is server-only by design, so its presence in a
// browser bundle is a compromise. Some keys are MEANT to ship to the client, and calling
// those critical is a false positive that discredits the entire report. Those are advisory
// instead, carrying the check that actually applies to them.
const OTHER_SECRETS = [
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, critical: true },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g, critical: true },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g, critical: true },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g, critical: true },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, critical: true },
  // Google browser keys (Maps, Places) cannot function unless they reach the client.
  // Secrecy was never the control; HTTP referrer and API restrictions are. Unrestricted,
  // the exposure is someone else billing their usage to you, not a data breach.
  {
    name: 'Google API key',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    critical: false,
    note: 'Expected in client code for Maps and Places. Confirm HTTP referrer and API restrictions are set in Google Cloud Console, otherwise the key works from any site and bills to you.',
  },
];

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function redact(s) {
  // Never write a usable credential into a report file. Enough to identify, not to use.
  if (s.length <= 18) return s.slice(0, 4) + '...';
  return `${s.slice(0, 12)}...${s.slice(-6)} (${s.length} chars)`;
}

/** Decode a JWT payload locally. No network, no signature verification, no use. */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function classifyJwt(token) {
  const p = decodeJwtPayload(token);
  if (!p) return null;
  const role = typeof p.role === 'string' ? p.role : null;
  const isSupabase = p.iss === 'supabase' || typeof p.ref === 'string' || role === 'anon' || role === 'service_role';
  if (!isSupabase) return null;
  return {
    kind: 'supabase-jwt',
    role: role ?? 'unknown',
    projectRef: p.ref ?? null,
    issuer: p.iss ?? null,
    expires: p.exp ? new Date(p.exp * 1000).toISOString().slice(0, 10) : null,
    expired: p.exp ? p.exp * 1000 < Date.now() : null,
    critical: role === 'service_role',
    token: redact(token),
  };
}

async function scanPage(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Every script the site serves. This is the same content any visitor's browser receives.
  const sources = new Map();

  page.on('response', async (res) => {
    try {
      const type = res.request().resourceType();
      if (type !== 'script' && type !== 'document' && type !== 'fetch' && type !== 'xhr') return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!/javascript|json|html|text/.test(ct)) return;
      const body = await res.text();
      if (body && body.length < 8_000_000) sources.set(res.url(), body);
    } catch {
      // Response body unavailable (redirect, cached, aborted). Nothing to read.
    }
  });

  let loadError = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    loadError = e.message.split('\n')[0];
  }

  if (loadError) {
    await context.close();
    return { url, error: loadError };
  }

  const title = await page.title();
  try {
    sources.set(url + ' (rendered DOM)', await page.content());
  } catch {
    // Page closed or navigated. The network-captured sources still stand.
  }

  await context.close();

  const findings = [];
  const projects = new Set();
  const seen = new Set();

  for (const [src, body] of sources) {
    for (const m of body.matchAll(SUPABASE_URL)) projects.add(m[1]);

    for (const m of body.matchAll(JWT)) {
      const info = classifyJwt(m[0]);
      if (!info) continue;
      const key = info.token + info.role;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ ...info, foundIn: src });
      if (info.projectRef) projects.add(info.projectRef);
    }

    for (const { name, re, critical } of NEW_KEYS) {
      for (const m of body.matchAll(re)) {
        const key = name + m[0];
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ kind: 'supabase-key', role: name, critical, token: redact(m[0]), foundIn: src });
      }
    }

    for (const { name, re, critical, note } of OTHER_SECRETS) {
      for (const m of body.matchAll(re)) {
        const key = name + m[0];
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ kind: 'other-secret', role: name, critical, note: note ?? null, token: redact(m[0]), foundIn: src });
      }
    }
  }

  findings.sort((a, b) => Number(b.critical) - Number(a.critical));

  return {
    url,
    title,
    sourcesInspected: sources.size,
    supabaseProjects: [...projects],
    findings,
    counts: {
      critical: findings.filter((f) => f.critical).length,
      informational: findings.filter((f) => !f.critical).length,
    },
  };
}

function buildReport(subject, pages, stamp) {
  const scanned = pages.filter((p) => !p.error);
  const critical = scanned.flatMap((p) => p.findings.filter((f) => f.critical));

  const L = [];
  L.push('# Client-side credential exposure check');
  L.push('');
  L.push(`**Subject:** ${subject}`);
  L.push(`**Date of assessment:** ${stamp.date}`);
  L.push(`**Pages assessed:** ${scanned.length}`);
  L.push(`**Evidence hash:** \`${stamp.hash}\``);
  L.push('');
  L.push('---');
  L.push('');
  L.push('## Method, and its limits');
  L.push('');
  L.push('This assessment reads the JavaScript each page serves to every visitor and decodes any');
  L.push('Supabase JSON Web Tokens found in it. A Supabase legacy key is an unencrypted JWT whose');
  L.push('payload carries a `role` claim, so its privilege level can be read directly from the token.');
  L.push('');
  L.push('**No connection was made to any database, and no key was used, tested or transmitted.**');
  L.push('Findings describe what is published in client code, not what an attacker achieved.');
  L.push('Credentials are redacted in this report.');
  L.push('');

  if (critical.length) {
    L.push(`## ${critical.length} critical finding${critical.length === 1 ? '' : 's'}`);
    L.push('');
    L.push('> A `service_role` key bypasses Row Level Security completely. Any visitor who reads the');
    L.push('> page source holds full read and write access to every table in the project, whatever the');
    L.push('> RLS policies say. A publishable or `anon` key in client code is expected and is not a');
    L.push('> finding on its own; a secret key never is.');
    L.push('');
    L.push('**If a `service_role` key appears below, treat it as live until rotated.** Rotate it in the');
    L.push('Supabase dashboard, move it to a server-only environment variable, and confirm RLS is');
    L.push('enabled on every table, since a leaked service key means RLS was never the control.');
    L.push('');
  } else {
    L.push('## No critical findings');
    L.push('');
    L.push('No `service_role` keys, Supabase secret keys or other credential shapes were found in');
    L.push('client-delivered code on the pages assessed.');
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('## Findings by page');
  L.push('');

  for (const p of pages) {
    if (p.error) {
      L.push(`### ${p.url}`);
      L.push('');
      L.push(`Could not be assessed: ${p.error}`);
      L.push('');
      continue;
    }
    L.push(`### ${p.title || p.url}`);
    L.push('');
    L.push(`\`${p.url}\``);
    L.push('');
    L.push(`${p.sourcesInspected} sources inspected. ${p.counts.critical} critical, ${p.counts.informational} informational.`);
    L.push('');
    if (p.supabaseProjects.length) {
      L.push(`Supabase project reference(s): ${p.supabaseProjects.map((r) => `\`${r}\``).join(', ')}`);
      L.push('');
    }
    if (!p.findings.length) {
      L.push('No Supabase credentials or other credential shapes detected in client code.');
      L.push('');
      continue;
    }
    L.push('| Severity | What | Detail | Found in |');
    L.push('|---|---|---|---|');
    for (const f of p.findings) {
      const sev = f.critical ? '**CRITICAL**' : 'info';
      const detail =
        f.kind === 'supabase-jwt'
          ? `role \`${f.role}\`${f.projectRef ? `, project \`${f.projectRef}\`` : ''}${f.expired === true ? ', expired' : ''}`
          : f.note
            ? `${f.token}. ${f.note}`
            : f.token;
      const where = f.foundIn.length > 80 ? f.foundIn.slice(0, 77) + '...' : f.foundIn;
      L.push(`| ${sev} | ${f.role} | ${detail} | ${where} |`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push(`_Assessed ${stamp.iso}. Evidence hash \`${stamp.hash}\` covers the raw result set stored alongside this report._`);
  L.push('');
  return L.join('\n');
}

const urls = process.argv.slice(2).filter((a) => a.startsWith('http'));
if (!urls.length) {
  console.error('Usage: node supabase-scan.mjs <url> [url...] [--name "Subject"]');
  process.exit(1);
}
const subject = arg('--name', new URL(urls[0]).hostname);

const browser = await chromium.launch();
const pages = [];
for (const url of urls) {
  process.stderr.write(`scanning ${url}\n`);
  const r = await scanPage(browser, url);
  if (r.error) process.stderr.write(`  error: ${r.error}\n`);
  else process.stderr.write(`  ${r.sourcesInspected} sources, ${r.counts.critical} critical, ${r.counts.informational} info\n`);
  pages.push(r);
}
await browser.close();

const now = new Date();
const raw = JSON.stringify({ subject, generatedAt: now.toISOString(), pages }, null, 2);
const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
const stamp = { iso: now.toISOString(), date: now.toISOString().slice(0, 10), hash };

const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join('reports', `${stamp.date}-${slug}-credentials`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'evidence.json'), raw);
writeFileSync(join(outDir, 'report.md'), buildReport(subject, pages, stamp));

const scanned = pages.filter((p) => !p.error);
const totalCritical = scanned.reduce((n, p) => n + p.counts.critical, 0);

console.log('');
console.log(`subject:     ${subject}`);
console.log(`pages:       ${scanned.length} scanned, ${pages.length - scanned.length} failed`);
console.log(`critical:    ${totalCritical}`);
console.log(`projects:    ${[...new Set(scanned.flatMap((p) => p.supabaseProjects))].join(', ') || 'none detected'}`);
console.log(`output:      ${outDir}`);
