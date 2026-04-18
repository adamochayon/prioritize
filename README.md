# Prioritize

A Google Apps Script tool for force-ranking team priorities into buckets — no hosting, no build step.

<!-- TODO: add screenshot -->

## Why this exists

Google Forms can collect votes but can't do drag-to-bucket ranking. Survey tools are overkill for a single sprint planning session. Spreadsheets work but look terrible and don't aggregate. Prioritize is the minimum viable ranking tool: paste 3 files, deploy, share a URL.

## Features

- 3 files of Apps Script — no CLI, no npm, no server
- Backed by Google Workspace identity; every vote tied to a real Google account
- Domain-restricted by default; results stay inside your org
- Two modes: MoSCoW (Must / Should / Could / Won't) and Top-N
- Scores aggregate across all voters; ties broken by standard deviation
- Items, buckets, and config live in an editable Google Sheet

## Deploy (3 minutes)

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. In the left sidebar, click the gear icon (Project settings) and check **"Show `appsscript.json` manifest file in editor"**.
3. Paste the contents of each file from this repo into the editor:
   - Replace the default `Code.gs` content with the repo's `src/Code.gs`.
   - Add an HTML file named `Index` and paste `src/Index.html` into it (Apps Script appends `.html` automatically).
   - Add HTML files for `Admin` and `NotAuthorized` the same way (from `src/Admin.html` and `src/NotAuthorized.html`).
   - Replace `appsscript.json` with the repo's `src/appsscript.json`.
4. Click **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone within [your organization] (recommended) or Anyone with a Google account
   - Click **Deploy** and accept the OAuth prompt.
5. Share the web app URL with your team.

## First-run experience

The first time you open the URL, the script creates a Google Sheet called "Prioritize — Submissions" in your Drive root. It pre-seeds 3 sheets: **Submissions** (vote records), **Config** (title, blurb, mode, bucket caps), and **Items** (the list to rank). 8 example items are loaded automatically. The account that ran the deploy is set as the admin.

## Configuring the tool

Open the admin view at `[your-web-app-url]?v=admin`. From there you can manage items and see all submissions. Items can also be edited directly in the Items sheet in the backing Google Sheet. See [docs/configuration.md](docs/configuration.md) for a full reference of Config sheet options.

## Modes

Prioritize supports two modes, set in the Config sheet. **MoSCoW** gives voters four named buckets (Must, Should, Could, Won't) with per-bucket caps and weights; the score for each item is the sum of bucket weights across all voters. **Top-N** is simpler: voters pick their top N items and everything selected gets equal weight. See [docs/modes.md](docs/modes.md) for cap and weight defaults.

## Customizing the code

See [docs/customizing.md](docs/customizing.md).

## Updating after code changes

Deploy → **Manage deployments** → pencil icon → set **Version** to **New version** → Deploy. If you redeploy without bumping the version, users get the cached old version.

## Finding the backing sheet

Option A: In the Apps Script editor, go to **Run → Run function → `getSheetUrl`** and check the execution log.

Option B: Search your Google Drive for "Prioritize — Submissions".

## License

MIT. See [LICENSE](LICENSE).

## Credits

Built by Adam Ochayon.
