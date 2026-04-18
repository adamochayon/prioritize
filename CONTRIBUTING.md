# Contributing to Prioritize

Thanks for your interest. Contributions are welcome — bug fixes, docs improvements, and new features alike.

## How the project works

Prioritize is a Google Apps Script web app. There is no build step, no npm, and no local server. All source lives in `src/`. The app is deployed directly to Google's infrastructure via the Apps Script editor or [clasp](https://github.com/google/clasp).

Because Apps Script can't run outside Google, **there are no automated tests**. All verification is done by deploying and clicking through the UI.

## Setup (clasp approach)

1. Fork this repo and clone it locally.
2. Install clasp: `npm install -g @google/clasp`
3. Log in: `clasp login`
4. Copy `.clasp.json.example` to `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your own script ID (create a new project at [script.google.com](https://script.google.com) to get one).
5. Push source to your Apps Script project: `clasp push`
6. Deploy as a web app from the Apps Script editor (see [README.md](README.md) step 4).

## Setup (no clasp)

Copy-paste each file from `src/` directly into the Apps Script editor. Faster for small changes.

## Making a change

- Read `CLAUDE.md` — it has the important conventions, gotchas, and entry points.
- Keep changes minimal and scoped. No speculative refactors.
- Test by deploying a new version and clicking through the affected flows.
- Apps Script deploy tip: **Deploy → Manage deployments → pencil → Version: New version → Deploy**. Skipping the version bump serves the cached old version.

## Submitting a PR

- One logical change per PR.
- Describe what you changed and why in the PR description.
- If your change affects user-visible behavior, describe how to verify it manually.

## Reporting bugs

Open a GitHub issue. Include:
- What you expected to happen
- What actually happened
- Whether you're on MoSCoW or Top-N mode, and roughly how many items/voters
