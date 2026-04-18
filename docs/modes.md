# Modes

Prioritize supports two modes: `moscow` and `topn`. Switch between them in the Admin view — the bucket definitions update automatically when you save.

---

## MoSCoW mode

MoSCoW is a standard prioritization framework where every item must be placed into one of four categories: Must have, Should have, Could have, Won't have. The forced allocation — you must fill each bucket to its cap before you can submit — is the point. It prevents the common failure mode of marking everything "important."

### Default buckets

| Bucket id | Label | Cap | Weight |
|-----------|-------|-----|--------|
| `must` | Must have | 3 | 12 |
| `should` | Should have | 4 | 6 |
| `could` | Could have | 4 | 2 |
| `wont` | Won't have | 5 | 0 |

Total items per submission: 16 (3 + 4 + 4 + 5).

### Weights

Weights convert bucket placements into a numeric score. A Must placement is worth 12 points, Should is worth 6, Could is worth 2, Won't is worth 0. Ratios worth noting:

- Must is worth 2× a Should, and 6× a Could.
- Won't contributes nothing to score — items that the group consistently places in Won't will sort to the bottom regardless of voter count.

### Aggregation

Each voter's placement contributes the bucket's weight to the item's total score. Items are sorted by score descending, with standard deviation ascending as a tiebreaker. Lower standard deviation means more consensus: two items with the same score rank higher if voters agree on their placement than if opinions are split.

### When to use MoSCoW

- You have a finite backlog (up to ~20 items) and want forced-bet prioritization.
- You want to distinguish between "we agree this is important" vs. "strong consensus it is critical."
- You want to surface Won't items explicitly — making deprioritization a first-class outcome.

---

## Top-N mode

Top-N is a lightweight polling mode. Each voter picks their top N items; everything else goes into a "Rest" bucket. There is no Must/Should/Could distinction — just "in" or "out."

### Default buckets

| Bucket id | Label | Cap | Weight |
|-----------|-------|-----|--------|
| `top` | Top N | N (configured) | 1 |
| `rest` | Rest | unlimited | 0 |

The cap on `top` determines N. The `rest` bucket has no cap (`null`), so remaining items fill it automatically.

### How scoring works

`top` has weight 1 and `rest` has weight 0. An item's score equals the number of voters who placed it in their top N. There is no weighting hierarchy — it is a simple vote count. The same stdev tiebreaker applies: among items with equal vote counts, those with more consistent placement rank higher (though in binary Top-N mode all weights are 0 or 1, so stdev mostly distinguishes items that received partial votes from items that were unanimously in or out).

### When to use Top-N

- Straw polls: "which 3 of these 12 topics should we cover next quarter?"
- Large item lists where MoSCoW's 16-item total is too restrictive.
- Situations where the nuance of Must/Should/Could is not needed and you just want vote counts.

---

## Switching modes with existing submissions

Changing `mode` (and the corresponding `buckets_json`) does not delete or migrate existing submissions. Stored submissions contain an `assignments_json` column that maps item ids to bucket ids (e.g., `{"sso": "must", "dark_mode": "should", ...}`). If you switch from MoSCoW to Top-N, old submissions reference bucket ids (`must`, `should`, `could`, `wont`) that no longer exist in the active bucket set. Those assignments are skipped during aggregation — the code checks `bucketWeightMap[bucketId] !== undefined` and silently ignores unknown bucket ids.

If you flip back to the original mode, the old submissions become relevant again. No data is lost by switching modes.

The practical implication: results during and after a mode switch will be incomplete until all participants resubmit under the new mode. It is advisable to notify participants when you change modes and ask them to resubmit.

---

## Custom bucket schemes

Custom bucket schemes are deliberately not supported in the UI. The intent is to keep the tool focused on two well-defined workflows.

If you need a custom scheme, fork the project and edit `DEFAULT_BUCKETS` in `Code.gs`. Be aware that bucket ids are not purely data — the CSS in `Index.html` has hardcoded color rules keyed to the known bucket ids:

```css
.bucket[data-bucket-id="must"]   { border-left: 3px solid var(--accent); }
.bucket[data-bucket-id="should"] { border-left: 3px solid var(--should-color); }
.bucket[data-bucket-id="could"]  { border-left: 3px solid var(--could-color); }
.bucket[data-bucket-id="wont"]   { border-left: 3px solid var(--wont-color); }
```

And the bucket selector buttons in `makeItemEl` are hardcoded to `must`, `should`, `could`, `wont`. Top-N ids `top` and `rest` are handled through the same bucket-rendering path in `renderBucketColumns`, so they inherit default styles. Any new bucket id you add will render without a distinctive color unless you add matching CSS rules.
