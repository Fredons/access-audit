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

## The manual protocol

[`MANUAL-PROTOCOL.md`](MANUAL-PROTOCOL.md) is the part the scanner cannot do: keyboard-only testing with the mouse physically unplugged, NVDA screen reader passes, deliberately breaking checkout forms to see whether errors are announced, zoom and reflow, target sizes. Six blocks, each check mapped to its success criterion.

It also carries two rules that keep an assessment defensible: never state or imply a legal opinion, and never claim conformance that has not been verified on the pages tested on the date tested.

## Standards

WCAG 2.1 AA and 2.2 AA, which is what EN 301 549 incorporates for the European Accessibility Act and what US courts have used as the de facto ADA benchmark.

MIT licensed.
