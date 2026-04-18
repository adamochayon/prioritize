# Prioritize

A zero-infra MoSCoW / Top-N ranking tool for teams, built as a Google Apps Script web app. Drag each item into a bucket, submit, see the aggregated results across your team.

Three files — that's the whole thing:

- `Code.gs` — backend (Apps Script, server-side)
- `Index.html` — frontend (single page, SortableJS via CDN)
- `appsscript.json` — manifest (web app config)

Persistence is a Google Sheet that the script auto-creates on first use. No secrets, no env vars, no hosting account.

> **This README is a placeholder.** A proper public-facing rewrite is in progress.

## Deploy (3 minutes, no CLI)

1. Go to [script.google.com](https://script.google.com) → **New project**.
2. In the editor, click the gear icon (⚙️ **Project settings**) in the left sidebar and check **"Show `appsscript.json` manifest file in editor"**.
3. Replace the default files with the contents of `Code.gs`, `Index.html`, and `appsscript.json` from this repo. Add `Index` as an HTML file (Apps Script adds `.html` automatically).
4. **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone within [your organization]** (recommended) or **Anyone with Google account**
   - Click **Deploy**. Accept the OAuth prompt.
5. Share the web app URL.

## Configuring the items and buckets

Edit the `ITEMS` and `BUCKETS` constants at the top of `Code.gs`. Keep the `id` field stable across edits — existing submissions reference items by id.

## License

MIT. See [LICENSE](LICENSE).
