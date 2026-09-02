# Manual audit protocol (US ADA / WCAG 2.1 AA)

The automated scan is the floor. This is the real assessment. Roughly 60 to 70 percent of real
WCAG failures are invisible to axe, and they are the ones plaintiff testers actually find,
because plaintiff testers use a keyboard and a screen reader on the checkout flow.

**Tooling, total cost $0:**

| Tool | Purpose | Cost |
|---|---|---|
| NVDA (NV Access) | Screen reader, the Windows standard | Free, open source |
| Keyboard | Tab, Shift+Tab, Enter, Space, Escape, arrows | Free |
| Chrome DevTools | Inspect, device toolbar, zoom, contrast | Free |
| audit.mjs (this repo) | Automated pass, evidence record | Free |

Time budget: 2.5 to 4 hours for a standard ecommerce site. Anything past 5 hours means the
site is bad enough that remediation, not assessment, is the priority.

---

## Scope: test the money path, not the whole site

Plaintiff testers follow the purchase journey. So do we. Five screens:

1. Home
2. Category or search results
3. Product detail
4. Cart
5. Checkout, including payment and error states

Add account creation and login if the site gates purchase behind it.

Everything below is run against each of those five screens. Record pass, fail, or not
applicable, plus a screenshot or a short screen recording for every fail. The evidence is
what makes the report defensible.

---

## Block A. Keyboard only (about 30 minutes)

Unplug the mouse. Genuinely. It is the only way to stay honest.

- [ ] **A1. Every interactive element is reachable by Tab.** Links, buttons, form fields,
      custom dropdowns, sliders, tabs, accordions, carousels. `WCAG 2.1.1`
- [ ] **A2. Nothing traps focus.** Tab into and back out of every widget, especially
      carousels, chat launchers, video players and cookie banners. `WCAG 2.1.2`
- [ ] **A3. Focus is always visible.** Look for `outline: none` with no replacement. This
      is the single most common serious failure on modern themes. `WCAG 2.4.7`
- [ ] **A4. Focus order follows visual order.** Tab through and watch the focus ring travel.
      Flex and grid reordering breaks this constantly. `WCAG 2.4.3`
- [ ] **A5. A skip link exists and works.** First Tab on the page. `WCAG 2.4.1`
- [ ] **A6. Modals trap focus deliberately and return it.** Open a modal: focus should move
      inside, stay inside, close on Escape, and return to the trigger. `WCAG 2.1.2, 2.4.3`
- [ ] **A7. Custom controls respond to expected keys.** Buttons on Enter and Space, menus on
      arrows, Escape closes. `WCAG 2.1.1`
- [ ] **A8. Hover-only content is also keyboard reachable.** Mega menus are the usual
      offender. `WCAG 2.1.1`

## Block B. Screen reader with NVDA (about 60 to 90 minutes)

Start NVDA (Ctrl+Alt+N). Use Insert+Down to read continuously, H to jump headings, B for
buttons, F for form fields, D for landmarks.

- [ ] **B1. Page has a unique, descriptive title.** Listen on load. `WCAG 2.4.2`
- [ ] **B2. Heading structure is logical.** One h1, no skipped levels, headings describe
      real sections. Press H repeatedly. `WCAG 1.3.1, 2.4.6`
- [ ] **B3. Images convey meaning.** Product images need real alt text, not the filename or
      the SKU. Decorative images must be silent. `WCAG 1.1.1`
- [ ] **B4. Links make sense out of context.** "Read more" and "click here" repeated twenty
      times is a failure. `WCAG 2.4.4`
- [ ] **B5. Buttons announce their purpose.** Icon-only buttons (cart, search, close,
      wishlist) are the classic silent failure. `WCAG 4.1.2`
- [ ] **B6. Form fields have programmatic labels.** Placeholder text is not a label.
      Press F through the checkout. `WCAG 1.3.1, 3.3.2`
- [ ] **B7. Landmarks exist.** header, nav, main, footer. Press D. `WCAG 1.3.1`
- [ ] **B8. Dynamic updates are announced.** Add to cart, cart count, filter results,
      validation messages. Missing live regions is extremely common. `WCAG 4.1.3`
- [ ] **B9. Custom widgets expose state.** Accordions announce expanded or collapsed,
      tabs announce selected, toggles announce pressed. `WCAG 4.1.2`
- [ ] **B10. Reading order matches visual order** when read continuously. `WCAG 1.3.2`

## Block C. Forms and errors (about 30 minutes, the highest-value block)

This is where lawsuits are won, because a blind user who cannot complete checkout has a
clean claim. Deliberately submit the checkout form empty, then with a bad email, then with
a bad card number.

- [ ] **C1. Errors are announced to the screen reader**, not only shown in red.
      `WCAG 3.3.1, 4.1.3`
- [ ] **C2. Errors identify the field and the problem** in text. "Invalid input" is a fail.
      `WCAG 3.3.1`
- [ ] **C3. Focus moves to the first error** or to a summary that lists them. `WCAG 3.3.1`
- [ ] **C4. Errors are not signalled by colour alone.** `WCAG 1.4.1`
- [ ] **C5. Required fields are programmatically marked**, not just an asterisk.
      `WCAG 3.3.2`
- [ ] **C6. Suggestions are offered where possible.** `WCAG 3.3.3`
- [ ] **C7. Autocomplete attributes are present** on name, email, address, payment fields.
      `WCAG 1.3.5`
- [ ] **C8. The order is reviewable and reversible before final submission.** `WCAG 3.3.4`

## Block D. Visual and responsive (about 30 minutes)

- [ ] **D1. Zoom to 200 percent.** No content lost, no horizontal scroll. `WCAG 1.4.4`
- [ ] **D2. Reflow at 320 CSS pixels wide.** DevTools device toolbar at 320px, or 400 percent
      zoom on a 1280px viewport. `WCAG 1.4.10`
- [ ] **D3. Contrast on text meets 4.5:1**, large text 3:1. Check hover, focus, disabled and
      placeholder states, which the automated pass often misses. `WCAG 1.4.3`
- [ ] **D4. Non-text contrast meets 3:1** for form borders, icons, focus indicators.
      `WCAG 1.4.11`
- [ ] **D5. Information is never conveyed by colour alone.** Sale badges, stock status,
      required markers, chart legends. `WCAG 1.4.1`
- [ ] **D6. Text spacing can be overridden** without clipping. `WCAG 1.4.12`
- [ ] **D7. Orientation is not locked** on mobile. `WCAG 1.3.4`
- [ ] **D8. Target sizes are at least 24 by 24 CSS pixels.** `WCAG 2.5.8 (2.2 AA)`

## Block E. Media and motion (about 15 minutes, skip if not present)

- [ ] **E1. Video has synchronised captions.** Auto-generated captions alone are usually a
      fail on accuracy. `WCAG 1.2.2`
- [ ] **E2. Pre-recorded video has audio description** where visual information carries
      meaning. `WCAG 1.2.5`
- [ ] **E3. Anything auto-playing over 5 seconds can be paused.** Carousels count.
      `WCAG 2.2.2`
- [ ] **E4. Nothing flashes more than three times per second.** `WCAG 2.3.1`
- [ ] **E5. Motion respects `prefers-reduced-motion`.** `WCAG 2.3.3`

## Block F. Overlay-specific checks (only if a widget is present)

- [ ] **F1. Record what the site returns with the widget blocked.** Run
      `node audit.mjs <url>` which does this automatically and reports the delta.
- [ ] **F2. Test with the widget active.** Does it break native screen reader behaviour?
      Overlays frequently interfere with NVDA's own browse mode.
- [ ] **F3. Check the widget's own controls are keyboard accessible.** They often are not.
- [ ] **F4. Note it factually in the report.** State what was found. Do not claim the
      overlay causes lawsuits, and do not reproduce vendor accusations. The verifiable
      facts are enough: the FTC ordered accessiBe to pay $1,000,000 in 2025 over compliance
      claims, and UsableNet's data shows lawsuits continue against sites running widgets.

---

## Scoring and output

For each failure record: screen, element selector, WCAG criterion, severity, what a user
experiences, and the fix. Severity ladder:

- **Blocker.** A user cannot complete purchase. Always fix first, always lead the report.
- **Serious.** Task completable but significantly harder.
- **Moderate.** Friction, not prevention.
- **Minor.** Best practice.

Then run `node audit.mjs` across the same five screens to attach the automated evidence
record with its hash and date. Deliver both together: the manual findings are the value,
the automated record is the dated proof.

## Two rules that keep this defensible

1. **Never state or imply a legal opinion.** You test technical conformance to WCAG 2.1 AA
   and report what you find. Whether that creates or removes legal liability is for their
   counsel. Write "does not conform to WCAG 2.1 AA success criterion 2.4.7", never "this is
   illegal" or "this will get you sued."
2. **Never claim conformance you have not verified.** Report covers the screens tested on
   the date tested. Conformance is assessed per page per date, and the report should say so.
