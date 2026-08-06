# Retired workflows (rollback artifacts)

These are **not** part of the live pipeline. They are the pre-split architecture,
kept as the documented rollback path: if the split pipeline ever needs to be
reverted, the rollback is to re-publish these.

They are exported here (credentials redacted) as a **reference backup**.

⚠️ **`SOV_Workflow_v2` should be ARCHIVED in n8n, not deleted** (Elan, 2026-08-06):
it maps essentially the whole system in one place and is the pre-split rollback
path. These exports are a reference, not a restore mechanism.

| Workflow | ID | Nodes |
|---|---|---|
| SOV Workflow v2 monolith pre split | `AcwUHkXhqgEPk8N8` | 78 |
| SOV dispatcher retired | `8WHJUxYZs73EvSl1` | 13 |
| SOV sub retired | `UBDKpvYUIZfDKS9y` | 23 |

⚠️ n8n credential *bindings* are keyed to node ID and are re-selected in the
n8n UI — they are not restored from these files.

_Exported 2026-08-06._
