# access-audit

A headless WCAG 2.1 AA and 2.2 AA scanner that produces a dated, hash-verified evidence record instead of a score.

```bash
npm install
npx playwright install chromium

node audit.mjs https://example.com https://example.com/cart --name "Example Co"
```

Writes `reports/YYYY-MM-DD-example-co/` containing `evidence.json` (the raw result set) and `report.md` (the readable assessment), stamped with a SHA-256 hash of the raw results.

## Why it exists in this shape

Most accessibility tools return a number. A number is not useful when the question is "what specifically fails, on which element, against which success criterion, on what date." Conformance is assessed per page on a given date, and a site that passes in March fails in April because someone shipped a new hero component. So the output is an evidence record, not a grade.

Three decisions drive the design.

**The report states its own scope limitation.** Automated rules detect a subset of WCAG failures. Keyboard operation, focus order, screen reader output and meaningful alternative text all need a human. Every report generated says so in the summary, in those words. A tool that implies automated conformance is selling the same thing the overlay vendors sell.

**Overlay widgets get blocked and re-scanned.** If the page carries accessiBe, UserWay, AudioEye, EqualWeb, User1st or Recite Me, the scanner runs the page a second time with those hosts aborted at the network layer, then reports the delta between the two runs.

That delta is the interesting number. Overlays repair the subset of failures automated scanners look for, which is exactly why an overlay site can score clean and still be inaccessible. The blocked run shows the delivered source, which is what a user meets whenever the widget fails to load, is blocked by a content blocker, or is bypassed by assistive technology. Conformance attaches to the delivered page, not to the repair layer.

**Detection is by script host and window global, not by visual fingerprint.** Six vendors, each matched on both their CDN host fragments and the globals they install (`acsbJS`, `UserWay`, `__AudioEyeSettings` and so on). Either signal is enough, so a vendor that changes its CDN or its bundle name still gets caught by the other.

## Two scripts

**`audit.mjs`** is the full pass: axe-core against `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, sorted by impact, with node counts, example selectors and truncated sample HTML per violation so a developer can find the element without re-running anything.

**`prospect.mjs`** is a fast pass over a domain list that skips axe entirely and only answers "is an overlay installed, and what platform is this." Roughly five times faster per site. Runs a worker pool, writes JSON plus a CSV.

```bash
node prospect.mjs domains.txt --concurrency 6
```

## Credential exposure (`supabase-scan.mjs`)

A second rule set over the same machine. It reads the JavaScript a page serves to every visitor and reports Supabase credentials that should never reach the browser.

```bash
node supabase-scan.mjs https://example.com https://example.com/app --name "Example Co"
```

**It reads and decodes. That is all it does.**

A Supabase legacy key is a JWT: three base64url segments, unencrypted, carrying a `role` claim. The token declares its own privilege level, so a dangerous key can be told apart from a harmless one by decoding a string the site already publishes, with no request to the project's API and no authentication attempt.

- An `anon` key in client code is intended and is not a finding.
- A `service_role` key in client code is critical. It bypasses Row Level Security entirely, so anyone who reads the page source has full read and write access to every table regardless of what the RLS policies say.

The newer `sb_secret_` and `sb_publishable_` formats are classified on their prefix. Anthropic, OpenAI, AWS, Stripe secret keys and private key blocks are reported too. Credentials are redacted in the report: enough to identify, never enough to use.

**This tool never connects to any database, never sends a discovered key anywhere, and never tests whether a key works.** Decoding a credential a site publishes is observation. Using it is unauthorised access, however carelessly it was exposed. That boundary is the reason this scanner is safe to run, and any change to it changes the legality of running it.

### Why it fetches scripts twice

Two passes collect the page's JavaScript, and both are needed.

The first listens to network responses. That is how a real browser sees the page, but it is timing-dependent: a chunk that loads late, arrives from cache, or lands after the wait window is never seen. The second enumerates every `script[src]`, `link[rel=preload][as=script]` and `link[rel=modulepreload]` the document declares, and fetches anything the listener missed.

The second pass exists because the first one is not trustworthy on its own. Scanning seven sites in one run captured 3 to 12 sources each where scanning them individually captured 17 to 28, and a known exposed key stopped being reported. On one Next.js site the listener saw 2 of the 10 scripts the HTML references, and the key was in one of the other 8.

That failure mode is the dangerous one. A false positive wastes someone's afternoon; a false negative hands them a clean report on an exposed database. So every report carries `scriptsDeclared` and `scriptsFetchedDirectly` alongside `sourcesInspected`, and a run where `sourcesInspected` is not comfortably above `scriptsDeclared` should be treated as incomplete rather than clean.

### One thing it deliberately does not call critical

Google browser keys (`AIza…`) cannot function unless they ship to the client. Secrecy was never the control for them; HTTP referrer and API restrictions are. They are reported as advisory, with the check that actually applies, because a scanner that cries critical over a key that is meant to be public discredits every real finding in the same report.

The first run of this tool against its author's own sites flagged exactly that false positive. The calibration above is the fix.

## The manual protocol

[`MANUAL-PROTOCOL.md`](MANUAL-PROTOCOL.md) is the part the scanner cannot do: keyboard-only testing with the mouse physically unplugged, NVDA screen reader passes, deliberately breaking checkout forms to see whether errors are announced, zoom and reflow, target sizes. Six blocks, each check mapped to its success criterion.

It also carries two rules that keep an assessment defensible: never state or imply a legal opinion, and never claim conformance that has not been verified on the pages tested on the date tested.

## Standards

WCAG 2.1 AA and 2.2 AA, which is what EN 301 549 incorporates for the European Accessibility Act and what US courts have used as the de facto ADA benchmark.

MIT licensed.
