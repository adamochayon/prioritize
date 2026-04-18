# Roadmap feature vote (top 5 of 20)

Use case: PM has 20 candidate items for the next 6 months and wants a quick straw poll: which 5 would each stakeholder pick? Low-stakes, high-signal voting to inform roadmap discussions.

## Config sheet values

| Key | Value |
|-----|-------|
| `mode` | `topn` |
| `buckets_json` | `[{"id":"top","label":"Top 5","weight":1,"cap":5},{"id":"rest","label":"Rest","weight":0,"cap":null}]` |
| `title` | `H2 roadmap vote` |
| `subtitle` | `Pick your top 5` |
| `results_visibility` | `after_submit` |
| `anonymous` | `false` |

## Items

| id | name |
|----|------|
| 1 | Mobile app (iOS/Android) |
| 2 | Single sign-on (SSO) |
| 3 | Public REST API |
| 4 | Audit log & compliance |
| 5 | Onboarding flow redesign |
| 6 | Third-party integrations |
| 7 | Database query optimization |
| 8 | AI-powered recommendations |
| 9 | Bulk data operations |
| 10 | Advanced filtering & search |
| 11 | Role-based access control |
| 12 | Dark mode |
| 13 | Export to CSV/Excel |
| 14 | Custom webhook events |
| 15 | Team collaboration features |
| 16 | Rate limiting & quotas |
| 17 | GraphQL API |
| 18 | Data migration tools |
| 19 | Spending alerts |
| 20 | Offline mode support |

## How to run it

Send the URL to your steering group Friday afternoon. Results are hidden until submission, so no anchoring bias. Close voting Wednesday morning. Load the results in your roadmap planning meeting and use the vote counts to surface consensus and disagreement. Top 5 items become your H2 planning anchor.
