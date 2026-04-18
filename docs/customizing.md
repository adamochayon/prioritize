# Customizing

This document is for developers who want to fork and modify Prioritize.

---

## File inventory

| File | Purpose |
|------|---------|
| `Code.gs` | Entire backend. Sheet plumbing, config/items readers and writers, submission logic, aggregation, and all `google.script.run`-callable functions. |
| `Index.html` | Rank and results UI. Contains inline CSS and JS. Rendered via `HtmlService` templating. |
| `Admin.html` | Admin view served at `?v=admin`. Config editor and items editor. |
| `NotAuthorized.html` | Fallback page shown when a non-admin requests `?v=admin`. |
| `appsscript.json` | Apps Script manifest. Declares OAuth scopes, webapp entry point, and runtime version. |

---

## Architecture

The frontend communicates with the backend exclusively through `google.script.run`. All calls are asynchronous; results arrive via `.withSuccessHandler()` / `.withFailureHandler()` callbacks. There is no HTTP API and no external server — the Apps Script runtime handles execution, and data lives entirely in the backing Google Sheet. `getBoot()` is the single bootstrap call that returns config, identity, and prior submission in one round trip. Subsequent calls (`saveSubmission`, `getResults`, `saveConfig`) are made on demand.

---

## Deploying the web app

Each instance of Prioritize is a standalone Apps Script web app deployment backed by one Google Sheet. The sheet is auto-created on first load and its id is stored in Script Properties (`SHEET_ID`).

**Steps to deploy:**

1. Create a new Apps Script project at [script.google.com](https://script.google.com).
2. Copy `Code.gs`, `Index.html`, `Admin.html`, `NotAuthorized.html`, and `appsscript.json` into the project.
3. Click **Deploy → New deployment → Web app**.
   - Execute as: **Me** (required — the script accesses Drive on behalf of the deployer).
   - Who has access: **Anyone within [your domain]** for org-internal use, or **Anyone with a Google account** for broader access.
4. Copy the deployment URL and distribute it.

**One deployment per ranking exercise.** If you want to run separate exercises (different item lists, different groups), deploy a separate project for each. There is no multi-tenant support within one deployment.

---

## Where to edit common things

### Visual theme

CSS custom properties are declared in the `:root` block near the top of `Index.html`:

```css
:root {
  --bg: #0d0f12;
  --bg-elev: #15181d;
  --border: #23272e;
  --text: #e6e6e6;
  --muted: #888;
  --accent: #4ade80;
  --should-color: rgba(74, 222, 128, 0.45);
  --could-color: #555;
  --wont-color: rgba(248, 113, 113, 0.5);
  --danger: #f87171;
  /* ... */
}
```

Edit these to change the color scheme globally. The bucket colors (`--should-color`, `--could-color`, `--wont-color`) are used in both the drag UI and the results distribution bars.

### Default seed data

On first boot, `Code.gs` seeds items and config from two constants:

```js
const DEFAULT_ITEMS = [
  { id: 'sso', name: 'Single sign-on (SAML / OIDC)' },
  // ...
];

const DEFAULT_BUCKETS = [
  { id: 'must',   label: 'Must have',   weight: 12, cap: 3 },
  { id: 'should', label: 'Should have', weight: 6,  cap: 4 },
  { id: 'could',  label: 'Could have',  weight: 2,  cap: 4 },
  { id: 'wont',   label: "Won't have",  weight: 0,  cap: 5 },
];
```

Replace `DEFAULT_ITEMS` with your actual backlog before deploying. The seeder only runs when the Items sheet has fewer than two rows, so changes to `DEFAULT_ITEMS` after first boot have no effect — edit the sheet directly instead.

For bucket changes, see [modes.md](./modes.md) for the constraints around bucket ids and CSS.

### Adding a new Config key

1. **Add a default** in `getConfigFromSheet_()` — add an entry to the `defaults` object.
2. **Read it from the sheet** — add a `map['your_key']` read in the return statement of `getConfigFromSheet_()`, with a fallback to the default.
3. **Seed it** — add a `['your_key', defaultValue]` pair to `defaultConfigRows` in `seedDefaultsIfEmpty_()`.
4. **Write it back** — add a branch in `saveConfig()` that maps the incoming payload field to the sheet key:
   ```js
   if (payload.yourKey !== undefined) updates['your_key'] = String(payload.yourKey);
   ```
5. **Expose it to the frontend** — if the frontend needs the value, add it to the return object of `getConfig_()`. It will arrive in `boot.config` via `getBoot()`.

---

## Iterating during development

Apps Script deployments are versioned. After editing code:

1. Go to **Deploy → Manage deployments**.
2. Click the pencil icon next to your active deployment.
3. Set **Version** to **New version**.
4. Click **Deploy**.

The deployment URL stays the same; the new code is live immediately after saving.

For CLI-driven iteration, [clasp](https://github.com/google/clasp) lets you push local edits directly to Apps Script without using the browser editor. See the clasp documentation for setup. A typical workflow is `clasp push` after edits, then create a new version via the web UI or `clasp deploy`.

---

## Data migrations

Submissions are stored as rows in the `Submissions` sheet with an `assignments_json` column. This column is a JSON object mapping item ids to bucket ids (e.g., `{"sso": "must", "api_v2": "should", ...}`).

**Before making breaking changes** (renaming item ids, removing items, changing bucket ids), archive the current `Submissions` sheet by duplicating it and renaming the copy. The live sheet can then be cleared or renamed and a fresh `Submissions` sheet will be recreated on the next request.

**Renaming an item id** severs the link between old submissions and the item. Old votes are silently ignored in aggregation. If you must rename, consider a find-and-replace on the `assignments_json` column in the sheet before changing the `Items` sheet.

**Removing an item** leaves orphan keys in old `assignments_json` values. The aggregation code skips unknown item ids, so this is safe — it just means old submissions will show a lower assigned count for affected items.

**Changing bucket ids** (e.g., forking to a custom scheme) invalidates all stored submissions for those buckets. The old bucket ids will not match any weight in the new `buckets_json`, so those assignments contribute zero to scores. Archive submissions before any bucket id change.
