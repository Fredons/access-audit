/**
 * Accessibility audit runner.
 *
 * Scans one or more URLs against WCAG 2.1 AA / 2.2 AA (the standards EN 301 549
 * incorporates for the EU Accessibility Act, and the de-facto ADA benchmark in the US),
 * detects whether an accessibility overlay widget is installed, and writes a dated
 * evidence record plus a client-ready report.
 *
 * Usage:
 *   node audit.mjs https://example.com
 *   node audit.mjs https://example.com/ https://example.com/cart --name "Client Name"
 */

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Overlay vendors: script host fragments and the globals they install.
const OVERLAYS = [
  { name: 'accessiBe',  hosts: ['acsbapp.com', 'accessibe.com'],   globals: ['acsbJS', 'acsb', 'accessiBeWidget'] },
  { name: 'UserWay',    hosts: ['userway.org', 'userway.com'],     globals: ['UserWay', 'userwayWidgetApp'] },
  { name: 'AudioEye',   hosts: ['audioeye.com'],                   globals: ['__AudioEyeSettings', '_audioEyeQue', 'AudioEye'] },
  { name: 'EqualWeb',   hosts: ['equalweb.com', 'nagich.co.il'],   globals: ['INDWEB', 'eqwGlobal'] },
  { name: 'User1st',    hosts: ['user1st.info'],                   globals: ['u1st'] },
  { name: 'Recite Me',  hosts: ['reciteme.com'],                   globals: ['ReciteMe', '_rmReady'] },
];

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function detectOverlay(page) {
  const scriptHosts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).map((s) => s.src)
  );
  const found = [];
  for (const o of OVERLAYS) {
    const viaScript = o.hosts.some((h) => scriptHosts.some((src) => src.includes(h)));
    const viaGlobal = await page.evaluate(
      (globals) => globals.some((g) => typeof window[g] !== 'undefined'),
      o.globals
    );
    if (viaScript || viaGlobal) {
      found.push({ vendor: o.name, evidence: viaScript ? 'script tag' : 'window global' });
    }
  }
  return found;
}

const ALL_OVERLAY_HOSTS = OVERLAYS.flatMap((o) => o.hosts);

async function auditPage(browser, url, { blockOverlay = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36',
  });

  // Overlays repair the subset of failures automated scanners look for, which is why an
  // overlay site can score clean and still be sued. Blocking the widget reveals the
  // underlying source, which is what a screen reader user meets when the script fails,
  // is blocked, or the user has JS restrictions.
  if (blockOverlay) {
    await context.route('**/*', (route) => {
      const u = route.request().url();
      return ALL_OVERLAY_HOSTS.some((h) => u.includes(h)) ? route.abort() : route.continue();
    });
  }

  const page = await context.newPage();

  let loadError = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Overlays and lazy content inject after first paint; give them a beat.
    await page.waitForTimeout(4000);
  } catch (e) {
    loadError = e.message;
  }

  if (loadError) {
    await context.close();
    return { url, error: loadError };
  }

  const title = await page.title();
  const overlays = await detectOverlay(page);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const violations = results.violations
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      wcag: v.tags.filter((t) => /^wcag\d/.test(t)),
      nodeCount: v.nodes.length,
      sampleTargets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      sampleHtml: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 200)),
    }))
    .sort((a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9));

  await context.close();

  return {
    url,
    title,
    overlays,
    violations,
    counts: {
      violations: violations.length,
      affectedElements: violations.reduce((n, v) => n + v.nodeCount, 0),
      critical: violations.filter((v) => v.impact === 'critical').length,
      serious: violations.filter((v) => v.impact === 'serious').length,
      moderate: violations.filter((v) => v.impact === 'moderate').length,
      minor: violations.filter((v) => v.impact === 'minor').length,
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    },
  };
}

function buildReport(client, pages, stamp) {
  const scanned = pages.filter((p) => !p.error);
  const totals = scanned.reduce(
    (acc, p) => {
      acc.violations += p.counts.violations;
      acc.affected += p.counts.affectedElements;
      acc.critical += p.counts.critical;
      acc.serious += p.counts.serious;
      return acc;
    },
    { violations: 0, affected: 0, critical: 0, serious: 0 }
  );

  const overlayVendors = [
    ...new Set(scanned.flatMap((p) => p.overlays.map((o) => o.vendor))),
  ];

  const lines = [];
  lines.push(`# Accessibility conformance audit`);
  lines.push('');
  lines.push(`**Subject:** ${client}`);
  lines.push(`**Standard:** WCAG 2.1 AA and 2.2 AA (as incorporated by EN 301 549)`);
  lines.push(`**Date of assessment:** ${stamp.date}`);
  lines.push(`**Pages assessed:** ${scanned.length}`);
  lines.push(`**Evidence hash:** \`${stamp.hash}\``);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`Automated testing found **${totals.violations} distinct conformance failures** affecting **${totals.affected} page elements**, of which **${totals.critical} are critical** and **${totals.serious} are serious**.`);
  lines.push('');

  if (overlayVendors.length) {
    lines.push(`> **An accessibility overlay is installed on this site (${overlayVendors.join(', ')}), and the failures below were detected with it active.**`);
    lines.push('>');
    lines.push('> This matters legally. In January 2025 the US Federal Trade Commission ordered accessiBe to pay $1,000,000 over claims that its widget could make a website WCAG compliant, finding those claims false, misleading or unsubstantiated. In the first half of 2025, 22.6 percent of US web accessibility lawsuits were filed against sites that had an overlay installed. A French court in June 2026 rejected partial conformance as a defence, holding accessibility to be an obligation of result.');
    lines.push('');
  }

  lines.push('**Scope limitation, stated plainly:** automated rules detect only a subset of WCAG failures. Keyboard operation, focus order, screen reader output, and meaningful alternative text require manual assessment. The findings below are therefore a floor, not a ceiling.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Findings by page');
  lines.push('');

  for (const p of pages) {
    if (p.error) {
      lines.push(`### ${p.url}`);
      lines.push('');
      lines.push(`Could not be assessed: ${p.error}`);
      lines.push('');
      continue;
    }
    lines.push(`### ${p.title || p.url}`);
    lines.push('');
    lines.push(`\`${p.url}\``);
    lines.push('');
    lines.push(
      `${p.counts.violations} failures across ${p.counts.affectedElements} elements ` +
        `(${p.counts.critical} critical, ${p.counts.serious} serious, ${p.counts.moderate} moderate, ${p.counts.minor} minor). ` +
        `${p.counts.incomplete} items need manual review.`
    );
    lines.push('');
    if (p.overlays.length) {
      lines.push(`Overlay detected: ${p.overlays.map((o) => `${o.vendor} (via ${o.evidence})`).join(', ')}`);
      lines.push('');
      if (p.overlayBlocked) {
        const b = p.overlayBlocked;
        lines.push(`**With the overlay blocked, the same page returns ${b.counts.violations} failures across ${b.counts.affectedElements} elements** (${b.counts.critical} critical, ${b.counts.serious} serious).`);
        lines.push('');
        lines.push(`That is a difference of ${b.delta.violations >= 0 ? '+' : ''}${b.delta.violations} failures and ${b.delta.affectedElements >= 0 ? '+' : ''}${b.delta.affectedElements} affected elements. The underlying source is what a user meets whenever the widget fails to load, is blocked by a content blocker, or is bypassed by assistive technology. Conformance is assessed on the delivered page, not on the repair layer.`);
        lines.push('');
      }
    }
    if (!p.violations.length) {
      lines.push('No automated failures detected on this page.');
      lines.push('');
      continue;
    }
    lines.push('| Impact | Failure | WCAG | Elements |');
    lines.push('|---|---|---|---|');
    for (const v of p.violations) {
      lines.push(`| ${v.impact} | ${v.help} | ${v.wcag.join(', ') || 'n/a'} | ${v.nodeCount} |`);
    }
    lines.push('');
    const top = p.violations.slice(0, 5);
    lines.push('**Detail on the highest-impact failures**');
    lines.push('');
    for (const v of top) {
      lines.push(`- **${v.help}** (${v.impact}, ${v.nodeCount} elements)`);
      lines.push(`  ${v.description}`);
      if (v.sampleTargets.length) lines.push(`  Example selector: \`${v.sampleTargets[0]}\``);
      lines.push(`  Reference: ${v.helpUrl}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## What happens next');
  lines.push('');
  lines.push('1. **Manual assessment** of keyboard operation, focus management, screen reader output and form error handling on the primary purchase or signup flow.');
  lines.push('2. **Remediation** of failures in priority order, critical and serious first.');
  lines.push('3. **Accessibility statement** prepared to Annex V of the EU Accessibility Act.');
  lines.push('4. **Re-verification and dated evidence record**, repeated on a schedule, because conformance is assessed per page on a given date and site changes reintroduce failures.');
  lines.push('');
  lines.push(`_Assessment generated ${stamp.iso}. Evidence hash \`${stamp.hash}\` covers the raw result set stored alongside this report._`);
  lines.push('');

  return lines.join('\n');
}

const urls = process.argv.slice(2).filter((a) => a.startsWith('http'));
if (!urls.length) {
  console.error('Usage: node audit.mjs <url> [url...] [--name "Client Name"]');
  process.exit(1);
}
const client = arg('--name', new URL(urls[0]).hostname);

const browser = await chromium.launch();
const pages = [];
for (const url of urls) {
  process.stderr.write(`scanning ${url}\n`);
  const withOverlay = await auditPage(browser, url);
  pages.push(withOverlay);

  // If a widget is present, re-scan with it blocked and record the delta.
  if (!withOverlay.error && withOverlay.overlays.length) {
    process.stderr.write(`  re-scanning with overlay blocked\n`);
    const blocked = await auditPage(browser, url, { blockOverlay: true });
    if (!blocked.error) {
      withOverlay.overlayBlocked = {
        counts: blocked.counts,
        violations: blocked.violations,
        delta: {
          violations: blocked.counts.violations - withOverlay.counts.violations,
          affectedElements: blocked.counts.affectedElements - withOverlay.counts.affectedElements,
        },
      };
    }
  }
}
await browser.close();

const now = new Date();
const raw = JSON.stringify({ client, generatedAt: now.toISOString(), pages }, null, 2);
const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
const stamp = { iso: now.toISOString(), date: now.toISOString().slice(0, 10), hash };

const slug = client.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outDir = join('reports', `${stamp.date}-${slug}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'evidence.json'), raw);
writeFileSync(join(outDir, 'report.md'), buildReport(client, pages, stamp));

const scanned = pages.filter((p) => !p.error);
const totalViolations = scanned.reduce((n, p) => n + p.counts.violations, 0);
const totalElements = scanned.reduce((n, p) => n + p.counts.affectedElements, 0);
const overlays = [...new Set(scanned.flatMap((p) => p.overlays.map((o) => o.vendor)))];

console.log('');
console.log(`client:      ${client}`);
console.log(`pages:       ${scanned.length} scanned, ${pages.length - scanned.length} failed`);
console.log(`violations:  ${totalViolations} distinct, ${totalElements} elements affected`);
console.log(`overlay:     ${overlays.length ? overlays.join(', ') : 'none detected'}`);
console.log(`output:      ${outDir}`);
