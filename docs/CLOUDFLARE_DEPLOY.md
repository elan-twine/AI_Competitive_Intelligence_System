# Cloudflare Pages deploy guide (frontend)

The dashboard is a Vite SPA that uses **hash-based routing** (`#dashboard`, `#login`, …), so no server-side rewrite/`_redirects` file is needed — `index.html` serves everything and routing happens client-side.

## One-time setup (Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git)
1. Authorize GitHub and pick **`esmyla/AI_Competitive_Intelligence_System_Twine_S26`**.
2. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** *(leave blank — repo root is the app)*
3. **Environment variables — these are BUILD-TIME, not runtime.** Vite inlines `import.meta.env.VITE_*` into the static bundle during `npm run build`, so they must be set where the **build** sees them (Build configuration / build environment variables), NOT the runtime "Variables and secrets" pane. That runtime pane will say *"Variables cannot be added to a Worker that only has static assets"* — that's expected; leave it empty. Set, for Production *and* Preview builds:
   - `VITE_SUPABASE_URL` = `https://addwjngdezmmnxddulll.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = *(your Supabase anon/public key — Dashboard → Project Settings → API)*
   - `NODE_VERSION` = `22` (Wrangler's deploy step needs Node 22+; also satisfies Vite 8)
   After adding them, **re-run the deploy** — earlier builds won't have them baked in. (The anon key being in the public bundle is by design; RLS protects the data. Never put the `service_role` key here.)
4. Save & Deploy. Cloudflare auto-deploys on every push to the default branch; PRs get preview URLs.

## Important: do this in the right order
1. Run migrations `0001` + `0002` in Supabase.
2. Enable Supabase Auth + create at least one user (otherwise login fails — the shared password is gone).
3. Confirm the frontend branch is pushed (currently the auth/competitors/metrics changes are committed but unpushed — I'll confirm before you connect).
4. Then connect Cloudflare Pages.

## Notes
- The existing `vercel.json` is harmless and ignored by Cloudflare; can be deleted later if you fully move off Vercel.
- The anon key is *meant* to be public (RLS enforces access) — safe to put in Pages env vars. Never put the **service_role** key in the frontend.
- After first deploy, set your custom domain in Pages → Custom domains if desired.
