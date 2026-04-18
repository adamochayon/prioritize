# Contributing to Prioritize

Thanks for your interest. Contributions are welcome — bug fixes, docs improvements, and new features alike.

## How the project works

Prioritize is a Google Apps Script web app. There is no build step, no framework, and no local server. All runtime source lives in `src/`; `scripts/setup.mjs` is a small Node helper that wraps [clasp](https://github.com/google/clasp) for install and redeploy. The app is deployed directly to Google's infrastructure.

Because Apps Script can't run outside Google, **there are no automated tests**. All verification is done by deploying and clicking through the UI.

## Setup (recommended)

1. Fork this repo and clone it locally.
2. Node 22+ is required. With [nvm](https://github.com/nvm-sh/nvm): `nvm use` picks up `.nvmrc`. Without nvm: install Node 22+ from [nodejs.org](https://nodejs.org).
3. `npm install && npm run setup` — creates your own Apps Script project and deploys it.
4. Edit files in `src/`. Run `npm run setup` again to push + redeploy. Or use `npm run push` / `npm run deploy` for the finer-grained steps.

To start from a clean project (e.g. to test first-run behavior): delete `.clasp.json` and re-run `npm run setup`. This creates a **separate** Apps Script project and a second backing Sheet — the existing one is not touched.

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
