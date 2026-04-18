# Configuration

All configuration lives in the `Config` sheet of the backing workbook. The Admin view (`?v=admin`) is a convenience wrapper; you can edit the sheet directly at any time and changes take effect immediately on the next page load. No redeployment is required.

---

## Config sheet keys

The `Config` sheet has two columns: `key` and `value`. The recognized keys are:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `title` | string | `Prioritize` | Heading text shown at the top of the rank view. |
| `subtitle` | string | `Rank the items below` | Secondary line shown below the blurb. Leave blank to omit. |
| `blurb` | string | *(built-in instruction text)* | Instructional paragraph shown above the ranking UI. Overwrite with your own framing for the exercise. |
| `mode` | string | `moscow` | Ranking mode. Accepted values: `moscow` or `topn`. See [modes](./modes.md). |
| `buckets_json` | JSON string | *(MoSCoW defaults)* | JSON array defining the buckets for the current mode. Managed automatically when you switch modes via the Admin view. See [modes](./modes.md) for the schema. |
| `results_visibility` | string | `always` | Controls when voters can see aggregated results. Accepted values: `always`, `after_submit`, `admin_only`. See [Results visibility](#results-visibility) below. |
| `anonymous` | boolean string | `false` | When `true`, voter names are hidden from results visible to non-admins. Accepted values: `true` or `false`. |
| `admin_emails` | string | *(deployer email)* | Newline- or comma-separated list of email addresses with admin access. |

---

## Admin emails

The `admin_emails` value is a single cell containing one or more email addresses separated by newlines or commas (or both). The backend normalizes whitespace and lowercases all addresses before comparison.

**Auto-seeding:** On first boot (when the backing sheet is first created), Prioritize seeds `admin_emails` with the email of the Google account that executed the script — typically the deployer's account. This happens via `Session.getEffectiveUser()`.

**Adding or removing admins:** Edit the `admin_emails` cell in the `Config` sheet directly. Put each address on its own line, or separate them with commas. Example:

```
alice@example.com
bob@example.com, carol@example.com
```

Removing an address takes effect immediately. There is no confirmation step — if you remove your own address you will lose admin access.

---

## Editing items in the Items sheet

The `Items` sheet defines what participants rank. Columns:

| Column | Description |
|--------|-------------|
| `id` | Unique string identifier for the item. Used as the key in stored submissions. Must be stable. |
| `name` | Display name shown to participants in the ranking UI. |
| `description` | Optional longer description. Not currently rendered in the rank view but stored and available. |
| `order` | Integer that controls display order. Items are sorted ascending by this value. |

Items are filtered to rows where `id` is non-empty. You can add, remove, or reorder rows freely.

> **Warning:** `id` must be stable — existing submissions reference items by id. If you change an `id` value, submitted rankings for the old id are silently ignored in aggregation. The item effectively has no votes until participants resubmit. If you need to rename the *display name*, change the `name` column instead; the `id` is never shown to participants.

---

## Mode and buckets

The `mode` key and `buckets_json` key work together. `mode` is a human-readable label (`moscow` or `topn`). `buckets_json` holds the actual bucket definitions used at runtime — it is what the backend validates submissions against and what the frontend renders.

When you switch modes via the Admin view, both keys are updated atomically. If you edit `buckets_json` directly in the sheet without updating `mode`, the frontend will use whatever is in `buckets_json` regardless of what `mode` says. The `mode` value is informational for the Admin UI; `buckets_json` is authoritative.

See [modes.md](./modes.md) for the full bucket schema and the behavior of each mode.

---

## Results visibility

The `results_visibility` key accepts three values:

| Value | Behavior |
|-------|----------|
| `always` | The Results tab is visible to all participants at any time, including before they submit. |
| `after_submit` | *(Reserved for future enforcement — currently treated the same as `always` in the frontend.)* |
| `admin_only` | Results are visible only to admins. Non-admins see a placeholder. |

> **Note:** `after_submit` enforcement is not yet implemented in the current frontend. Until it is, it behaves identically to `always`. If you need results gated until after submission, use `admin_only` and share results manually.

---

## Anonymous mode

When `anonymous` is set to `true`:

- Voter names are replaced with `"Anonymous"` in the results view shown to non-admins.
- The individual submissions list is hidden from non-admins.
- Aggregated scores and bucket distribution bars are still visible (they contain no names).

**Admin always sees full data.** Admins (addresses listed in `admin_emails`) always receive the full, unanonymized results regardless of the `anonymous` setting. The anonymization is applied server-side in `getResults()` based on `isAdmin_()`.

What anonymous mode does *not* hide: the submission is still stored with the voter's email and display name in the `Submissions` sheet. Anyone with direct sheet access can see who voted. Anonymous mode is presentation-layer only.
