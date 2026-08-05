# DB-on-Cloudflare feasibility spike (D1) — decision support

You asked to decide the database platform after I scoped the migration. Here's the concrete scope.

## What you have today
Supabase gives you four things in one bundle:
1. **Postgres** (the actual data)
2. **PostgREST** — an auto-generated REST API over every table (this is what `supabase-js` calls)
3. **Auth** — the per-user login we just wired in (`supabase.auth`)
4. **Browser client** — `@supabase/supabase-js`, used directly from React and via raw REST in n8n

## What Cloudflare offers
- **D1** = serverless **SQLite**. Just the database — no auto REST API, no auth, no browser client.
- **Hyperdrive** = a connection accelerator to an *existing* Postgres from Workers. Doesn't replace Supabase; could *complement* it.
- There is **no** Cloudflare managed-Postgres-with-auto-API-and-auth equivalent to Supabase.

## What a full move to D1 actually requires
| Work item | Effort | Risk |
|---|---|---|
| Schema migration Postgres → SQLite (types, `jsonb`→`text`, `uuid`/`gen_random_uuid`, `text[]` arrays, `on_conflict` upserts all differ) | M | data-loss / subtle-bug risk |
| Build a **Cloudflare Worker API** to expose tables to the browser (D1 isn't browser-queryable) | L | new surface area to secure |
| Re-implement **auth** (D1 has none) — replace the Supabase Auth we just added, or front it with Cloudflare Access | L | security-sensitive |
| Rewrite **every n8n DB node** (30+ Supabase ops, incl. raw `?on_conflict=` REST upserts) to call the Worker API or D1 HTTP | L | breaks all pipelines until done |
| Rewrite the React data layer (`supabase.js`, all hooks) to hit the Worker API | M | — |
| Re-test the entire system end-to-end | M | — |

**Estimate: ~1.5–3 focused weeks**, and it's a net feature *downgrade* (SQLite < Postgres) for this workload. It cannot land by Friday without breaking things.

## Recommendation
**Keep the database on Supabase; deploy only the frontend to Cloudflare.** You still get "it's on Cloudflare" for the part that benefits (global CDN, fast static hosting) without re-architecting a working data+auth layer days before the deadline.

If "fully on Cloudflare" is a hard requirement later, the clean path is a dedicated project: stand up the Worker API + D1 + Cloudflare Access behind the existing frontend, cut over n8n table by table. Happy to scope that as a follow-up after Friday.

**Optional middle ground:** keep Supabase Postgres but add **Hyperdrive** if/when you build Cloudflare Workers that need fast Postgres access. No migration, no downgrade.
