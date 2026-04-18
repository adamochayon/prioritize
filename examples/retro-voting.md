# Sprint retro voting

Use case: Retro facilitator has 15 discussion topics captured during brainstorm and wants the team to vote on the 3 worth discussing. Anonymous voting ensures people vote their conscience without hierarchy.

## Config sheet values

| Key | Value |
|-----|-------|
| `mode` | `topn` |
| `buckets_json` | `[{"id":"top","label":"Top 3","weight":1,"cap":3},{"id":"rest","label":"Rest","weight":0,"cap":null}]` |
| `title` | `Sprint 24 retro` |
| `subtitle` | `Pick the 3 topics you most want to discuss` |
| `results_visibility` | `admin_only` |
| `anonymous` | `true` |

## Items

| id | name |
|----|------|
| 1 | Standups are too long |
| 2 | PR review queue piling up |
| 3 | On-call burnout |
| 4 | Missing design reviews |
| 5 | Too many Slack channels |
| 6 | Release process is painful |
| 7 | Documentation falling behind |
| 8 | Testing coverage gaps |
| 9 | Unclear sprint goals |
| 10 | Dependencies blocking our work |
| 11 | Meetings eating dev time |
| 12 | Incident response unclear |
| 13 | Deploys are risky |
| 14 | Onboarding new team members |
| 15 | Technical debt accumulating |

## How to run it

Send the URL at the start of the retro. Give the team 5 minutes to vote. Explain that votes are anonymous so they can be honest. Once time is up, load the results on screen. The top 3 topics become your discussion agenda for the remaining 40 minutes. Skip topics that didn't make the cut.
