# n8n workflow exports

Sanitized exports of the live SOV pipeline — the scraping and scoring logic that
is **not** otherwise in this repo. Credentials are redacted (`<REDACTED_*>`); n8n
credential *bindings* are keyed to node ID and are re-selected in the n8n UI, not
restored from these files.

**These are a reference + disaster-recovery copy, not a deploy mechanism.** n8n is
the source of truth; re-export after changing a workflow (`ops/scripts/export_n8n.sh`).

| Workflow | ID | Active | File |
|---|---|---|---|
| Competitor Brief Generator | `CLz0IumaOJpg4XaG` | ✅ | `Competitor_Brief_Generator.json` |
| Error Handling | `E6P5SOCGjq6yrOSO` | ✅ | `Error_Handling.json` |
| LinkedIn Employee Engagement OKR | `WvL1T5evClTBlioK` | ✅ | `LinkedIn_Employee_Engagement_OKR.json` |
| SOV AI Answers | `84SYvmU9SID6Ikxd` | ✅ | `SOV_AI_Answers.json` |
| SOV Author Relationship | `LiFignB8kRZzWLKQ` | ✅ | `SOV_Author_Relationship.json` |
| SOV Decay Refresh | `QW3X8MfWMvnTuI4N` | ✅ | `SOV_Decay_Refresh.json` |
| SOV Embed Feedback | `x6jkdpG4gW5AEnex` | ✅ | `SOV_Embed_Feedback.json` |
| SOV Google News | `xVOA25o3tZlAnSCx` | ✅ | `SOV_Google_News.json` |
| SOV LI Engagement Refresh daily | `ZIo4udMp7tl6p5Ai` | ✅ | `SOV_LI_Engagement_Refresh_daily.json` |
| SOV LI Engagement Refresh thisweek | `SYyoZMl6FVXO58vo` | ✅ | `SOV_LI_Engagement_Refresh_thisweek.json` |
| SOV LinkedIn Processor | `F2EclaqNpxi054iI` | ✅ | `SOV_LinkedIn_Processor.json` |
| SOV LinkedIn Scraper v2 | `BbG5NbWDjQgHHIGw` | ✅ | `SOV_LinkedIn_Scraper_v2.json` |
| SOV Posts of Interest | `YuFF9TKneDykROOx` | ✅ | `SOV_Posts_of_Interest.json` |
| SOV Reddit | `qN2hd39B7AlUlXb3` | ✅ | `SOV_Reddit.json` |
| SOV Spike Alerts | `hfsxSUpewVOTl02f` | ✅ | `SOV_Spike_Alerts.json` |
| SOV URN Resolver | `4vdZBbeTJRPwrF6W` | ✅ | `SOV_URN_Resolver.json` |
| SOV Weekly Digest | `HReiMg5ddmYkMrMA` | ✅ | `SOV_Weekly_Digest.json` |
| SOV Weekly Snapshot | `hNauQrczVV1VDxCF` | ✅ | `SOV_Weekly_Snapshot.json` |
| SOV X | `3aYO4hfbwRbx7tv0` | ✅ | `SOV_X.json` |
| SOV X Engagement Refresh daily | `wqG66ZNm43McKx0i` | ✅ | `SOV_X_Engagement_Refresh_daily.json` |
| SOV X Engagement Refresh thisweek | `gkjjbJq0W3TpPilA` | ✅ | `SOV_X_Engagement_Refresh_thisweek.json` |

_Exported 2026-08-05 — 21 workflows._
