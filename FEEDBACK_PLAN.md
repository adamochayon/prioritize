# Feedback implementation plan

This is a session-scoped plan. It will be deleted (or merged into commits) once all batches land. **Not a long-lived doc.**

Source: Adam's feedback after his first real-world test of the public-facing app. The batches below are grouped to minimize cross-batch conflicts and to let independent batches run in parallel.

Orchestrator: main Claude Code session. Implementers: sub-agents dispatched via the `Agent` tool (prefer `apps-script-implementer` if available, otherwise `general-purpose` with a complete spawn prompt).

---

## Execution order

Dependencies matter — don't parallelize across waves.

- **Wave A (parallel):** Batch 1, Batch 5, Batch 6
- **Wave B:** Batch 2 (must land before 3)
- **Wave C:** Batch 3 (must land before 4)
- **Wave D:** Batch 4

After each batch: orchestrator reviews the diff, runs `git diff` sanity check, commits with a scoped message, then dispatches the next wave.

---

## Decisions already made

- **Drop the Top-N "Rest" bucket entirely.** Top-N submissions record only the Top items; everything else is implicitly unranked.
- **Mode switches delete existing submissions.** Migrating bucket IDs across modes is messy and low-value; admin gets a confirm prompt before the switch.
- **Anonymization is UI-only.** The Sheet always records `email` + `display_name` (audit trail). `getResults()` strips names for non-admins when `anonymous=true`.
- **README screenshot placeholder stays** until Adam provides one. Remove the broken `<img>` reference; leave a TODO comment.
- **`appsscript.json` timezone is a per-deploy choice** and will not be committed.

---

## Batches

### Batch 1 — Admin link URL bug (CRITICAL, small)

**Problem.** Clicking "Admin" navigates the inner `userCodeAppPanel` iframe to `?v=admin`, not the outer `/exec?v=admin`. Same issue for the admin → rank return link.

**Fix.**
1. In `Code.gs`, add the web-app URL to `getBoot()` and `getAdminBoot()` returns: `webAppUrl: ScriptApp.getService().getUrl()`.
2. In `Index.html`, when rendering the Admin link, set `href` to `${boot.webAppUrl}?v=admin` and `target="_top"` so it escapes the iframe.
3. In `Admin.html`, same treatment for any "back to ranking" link.

**Acceptance.**
- Clicking "Admin" from the main view loads the admin panel without error.
- Clicking "View ranking" (or equivalent) from Admin returns to the main view.
- Both work in Chrome and Safari on desktop.

**Files.** `Code.gs`, `Index.html`, `Admin.html`.

---

### Batch 2 — Top-N: drop Rest, add quick-select

**Problem.** Top-N shows a "Rest" bucket with cap `undefined` and copy like "X out of undefined". Drag-to-bank is also clunky compared to MoSCoW's M/S/C/W quick-select buttons.

**Fix.**
1. In Top-N mode, render only one bucket (the top one). Items not placed there stay in the bank (implicitly unranked).
2. Remove the `rest` bucket from the default Top-N bucket config and from `DEFAULT_BUCKETS` derivation for Top-N mode.
3. Add quick-select buttons analogous to MoSCoW: `⇑ Top` / `↓ Skip` on each item row.
4. Update `validateAssignments_()`: Top-N mode requires exactly `top.cap` items assigned to the top bucket; unassigned items are allowed (they're the implicit rest).
5. Update `aggregate_()` to handle missing assignments gracefully — items not in any bucket get 0 score.
6. Update the Top-N bucket config shape in the Config sheet: a single `{ id: 'top', label: 'Top', weight: N, cap: N }` row.

**Acceptance.**
- Top-N shows one bucket with a visible cap (e.g. "3 / 3 ✓").
- Bank shows remaining unranked items; no "undefined" anywhere.
- Quick-select works both ways (put in Top, remove from Top).
- Submit requires exactly `cap` items in Top.
- No broken CSS selectors that reference `.bucket[data-bucket-id="rest"]`.

**Files.** `Code.gs`, `Index.html`, `Admin.html`.

---

### Batch 3 — Bucket caps + mode-switch sanity

**Problem.** Default MoSCoW caps (3+4+4+5 = 16) exceed default item count (8). Toggling modes leaves orphan bucket IDs in submissions, which poisons the UI.

**Fix.**
1. Change `DEFAULT_BUCKETS` to caps that sum to 8: `must: 2, should: 2, could: 2, wont: 2` (weights unchanged). Update the fallback in `getConfigFromSheet_()` to match.
2. In `saveConfig(payload)`, validate that `sum(bucket.cap for bucket in buckets) === items.length` unless any cap is `null`/`0` (unlimited). Reject with a clear error message otherwise.
3. In `saveConfig(payload)`, if `mode` is changing, wipe `Submissions` (after confirming). Expose this as an explicit flag the client must set: `{ mode: 'topn', confirmSubmissionsWipe: true }`. Reject with a specific error if the flag is missing on a mode change.
4. In `Admin.html`, when the admin toggles mode: show a confirm dialog ("This will clear N existing submissions. Continue?"), and on confirm, send the request with `confirmSubmissionsWipe: true`.
5. When switching Top-N → MoSCoW with empty buckets, re-seed MoSCoW defaults (`DEFAULT_BUCKETS`) into the Config sheet.

**Acceptance.**
- Fresh install: 8 items, 2/2/2/2 caps, counters add to 8.
- Admin sets caps that don't sum to item count → save rejects with clear error, Config sheet unchanged.
- Admin switches mode → sees confirm dialog → submissions cleared → UI reflects new mode cleanly.
- Top-N → MoSCoW populates sensible defaults, not an empty bucket list.

**Files.** `Code.gs`, `Admin.html`.

---

### Batch 4 — Admin UI surface (items + bucket editing)

**Problem.** Admin currently only edits top-level config. Items must be edited in the Sheet directly, which defeats the "no Sheet editing required" goal.

**Fix.**
1. In `Admin.html`, add an Items management section: list items, add row, rename, delete, reorder (drag or up/down buttons).
2. Add a Buckets management section: edit label, weight, cap per bucket; add/remove bucket (MoSCoW mode only).
3. Extend `saveConfig(payload)` to accept `items` and `buckets` arrays, write them back to the Items / Config sheets atomically, and re-run Batch 3's cap validation.
4. All changes save via one "Save" button (not per-row).

**Acceptance.**
- Admin can add, rename, delete, reorder items without opening the Sheet.
- Admin can edit bucket weights and caps with validation from Batch 3.
- Invalid configurations show inline errors and don't write to the Sheet.
- Existing submissions that reference a deleted item gracefully degrade (score doesn't include the deleted item).

**Files.** `Code.gs`, `Admin.html`.

**Note.** This is the biggest batch. If it gets large, split into 4a (items CRUD) and 4b (bucket editing).

---

### Batch 5 — Anonymization + Reset

**Problem 1.** Hiding submitter names in results doesn't fully work — names still leak in the "Individual submissions" details pane.

**Problem 2.** No way for a user to reset their own submission.

**Fix.**
1. Audit `getResults()`: when `cfg.anonymous && !admin`, both `items[].voters[].voter` AND the `submissions` array must be anonymized. Currently the code zeroes `submissions` to `[]`, which hides too much (people want to see anonymous submission *content*, just not *names*). Return anonymized submissions with `displayName: 'Anonymous'` and `email: ''` instead.
2. Always record `email` + `display_name` in the Submissions sheet regardless of `anonymous` setting — it's an audit trail for the admin.
3. Add a "Reset my ranking" button on the Rank view, visible only when `state.hasPriorSubmission`. Clicking it calls a new server function `deleteMySubmission()` which removes the caller's row under `LockService`.
4. After reset, UI clears all bucket assignments back to the bank and re-renders the identity strip.

**Acceptance.**
- With `anonymous=true`, a non-admin sees "Anonymous" in voter chips AND in the Individual Submissions details.
- Admins always see real names.
- Sheet always has real emails.
- Reset button works, UI updates instantly, `getBoot()` on reload shows no prior submission.

**Files.** `Code.gs`, `Index.html`.

---

### Batch 6 — Copy + docs (low risk)

**Fix.**
1. Rewrite `DEFAULT_BLURB` in `Code.gs` to be friendlier and less Oasis-internal. Keep it under 2 sentences. Something like: "Rank these items into buckets to see where the group agrees and where it splits. Save anytime — resubmit to update."
2. Change default `subtitle` from "Rank the items below" to empty string (let the title stand alone).
3. In `README.md`, remove the `![Prioritize screenshot](docs/screenshot.png)` line (the file doesn't exist). Leave a TODO comment: `<!-- TODO: add screenshot -->`.
4. **Optional (nice-to-have):** skeleton loading state in `Index.html` while `getBoot()` is in flight. If you add this, keep it minimal — a single gray rectangle per bucket is enough. Skip if it balloons the diff.

**Acceptance.**
- Fresh install shows the new blurb, no awkward subtitle.
- README renders without a broken image.

**Files.** `Code.gs`, `Index.html`, `README.md`.

---

## Dispatch template

When dispatching a batch to a sub-agent, use this shape:

```
You are implementing Batch <N> of FEEDBACK_PLAN.md in the Prioritize repo at /Users/adamochayon/development/prioritize.

Read these files before editing:
- CLAUDE.md (repo orientation, Apps Script gotchas)
- FEEDBACK_PLAN.md (full context — your batch section is authoritative)
- <specific files the batch touches>

Implement only Batch <N>. Do not touch other batches. Do not add speculative features. Keep the diff minimal.

Report back with:
1. Summary of changes (one paragraph)
2. List of files modified
3. Anything you decided to skip or defer, and why
4. Any new assumptions you made

Do not commit. The orchestrator will review and commit.
```

---

## Post-completion

Once all six batches are in and manually verified in the deployed app:
1. Delete this file.
2. Squash or clean up commits if any are trivial.
3. Update `docs/` if any documented behavior changed (anonymization semantics, Top-N shape, cap validation).
