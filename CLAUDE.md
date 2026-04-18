# Prioritize — orientation for Claude

Single-file Google Apps Script web app for force-ranking team priorities into buckets (MoSCoW or Top-N). Serves HTML directly from Apps Script, persists to an auto-created Google Sheet.

## Repo layout

- `Code.gs` — backend. Single file, global namespace.
- `Index.html` — main UI (Rank + Results views). Inline CSS + JS.
- `Admin.html` — admin UI (config form + results pane).
- `NotAuthorized.html` — shown to non-admins hitting `?v=admin`.
- `appsscript.json` — runtime manifest.
- `docs/` — user-facing docs (configuration, modes, customizing).
- `examples/` — example item sets.

## Architecture in 5 bullets

- Google Apps Script web app. No build step, no npm, no framework.
- Backend is one `Code.gs` file with shared global namespace. V8 runtime (roughly ES2020).
- Client calls server via `google.script.run.<fn>()` — callback-based, not promises.
- State lives in a single Google Sheet with three tabs: `Submissions`, `Config`, `Items`. Script auto-creates it on first run and stashes the ID in `PropertiesService`.
- Two modes (MoSCoW, Top-N) selected via Config sheet. Buckets and weights are data, not code.

## Entry points worth knowing

- `doGet(e)` — routes `?v=admin` to `Admin.html` or `NotAuthorized.html`; everything else to `Index.html`.
- `getBoot()` — single call the Index UI makes on load (config + identity + prior submission + isAdmin).
- `getAdminBoot()` — single call the Admin UI makes on load.
- `saveSubmission(payload)` — validates then upserts by email under `LockService`.
- `getResults()` — handles visibility gating + anonymization.
- `saveConfig(payload)` — admin-only config writer.
- `validateAssignments_()` — authoritative validator for cap rules.
- `aggregate_()` — scoring.

## Apps Script gotchas (the non-obvious ones)

- **Iframe URL trap**: `<a href="?v=admin">` navigates the inner `userCodeAppPanel` iframe, not the outer `/exec` URL. For internal links between views, surface `ScriptApp.getService().getUrl()` from the server and use that absolute URL client-side.
- **Deploy cache**: after edits, `Deploy → Manage deployments → pencil → Version: New version → Deploy`. Skipping the version bump serves users the stale HTML.
- **Identity**: `Session.getActiveUser().getEmail()` only returns a non-empty value when the script runs as `Execute as: Me` and the viewer is in the same Workspace domain. Outside that, it returns `""`.
- **No local tests**: Apps Script doesn't run outside Google. Reason about correctness by reading; verify by deploying and clicking.
- **V8 quirks**: supports most ES2020. Avoid top-level `await`, ES modules, `import`. No `fetch` — use `UrlFetchApp`.
- **Concurrent writes**: always wrap Submissions mutations in `LockService.getScriptLock()`.

## Conventions in this codebase

- Trailing-underscore functions (`foo_`) are private by convention — not called from the client.
- Config defaults live in one place: `DEFAULT_CONFIG` at the top of `Code.gs`. `ensureInstalled_` seeds from it and `getConfig_` falls back to it.
- Dark terminal aesthetic. CSS variables at the top of `Index.html` (`--bg`, `--accent`, etc.) — reuse them rather than hard-coding colors.
- Bucket ids (`must`, `should`, `could`, `wont`) are hard-coded in some CSS selectors (`.bucket[data-bucket-id="must"]`). If you add new bucket ids you'll need to update those too.

## Working on this repo

- Before editing, read the target file in full — the files are small enough.
- Prefer editing existing functions over adding new ones. The file is deliberately flat.
- Keep changes minimal and scoped. No speculative refactors.
- When a UI string is configurable (title, subtitle, blurb), update `DEFAULT_CONFIG` — both the installer and the runtime fallback read from it.
- Sheet-side setup is one-shot: `ensureInstalled_()` runs on the first request after deploy (gated on `ScriptProperties.INSTALLED_AT`) and is a no-op thereafter. Getters (`getConfigSheet_`, etc.) are pure — they do not seed or repair.
- Do not commit `.clasp.json` (it's gitignored). Do not commit changes to `appsscript.json` timezone — that's a per-deploy choice.
