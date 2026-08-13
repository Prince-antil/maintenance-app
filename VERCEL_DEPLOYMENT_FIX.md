# Vercel Deployment Fix

## Problem
Build failed on Vercel with: `sh: line 1: vite: command not found`

**Root Cause:** 
- Vercel's build environment wasn't installing devDependencies
- The `vercel.json` configuration didn't specify the correct build command and output directory
- Vite is in `client/devDependencies`, not in the root

## Solution Applied

### Updated `vercel.json`
```json
{
  "buildCommand": "cd client && npm run build",
  "outputDirectory": "client/dist",
  "installCommand": "npm install && cd client && npm install",
  "env": {
    "VITE_SUPABASE_URL": "@supabase_url",
    "VITE_SUPABASE_ANON_KEY": "@supabase_anon_key"
  },
  "functions": {
    "api/index.js": {
      "includeFiles": "node_modules/sql.js/dist/sql-wasm.wasm"
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" },
    { "source": "/assets/(.*)", "destination": "/assets/$1" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### What Changed:
1. ✅ **Added `buildCommand`**: Explicitly navigate to `client` directory and run `npm run build`
2. ✅ **Added `outputDirectory`**: Tells Vercel the build output is in `client/dist`
3. ✅ **Added `installCommand`**: Ensures both root and client dependencies are installed
4. ✅ **Added `env`**: References to Supabase environment variables (configure these in Vercel dashboard)
5. ✅ **Fixed `rewrites`**: Removed `/client/dist/` prefix since outputDirectory is already set

## Next Steps

### 1. In Vercel Dashboard
Go to your project settings and add environment variables:
- `VITE_SUPABASE_URL` = Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = Your Supabase anonymous key

### 2. Trigger a Redeploy
```bash
git add vercel.json
git commit -m "fix: Vercel build configuration for Vite client"
git push origin main
```

Vercel will automatically redeploy. The build should now:
1. Install root dependencies
2. Install client dependencies (including vite)
3. Run `npm run build` in the client directory
4. Deploy the `client/dist` output

### 3. Verify
After deployment succeeds, test:
- ✅ Frontend loads at main domain
- ✅ API routes work at `/api/...`
- ✅ SPA routing works (refresh on any route should show app, not 404)
- ✅ Assets load correctly
- ✅ Supabase connection works (check console for auth errors)

## Alternative: Monorepo with Separate Deployments

If you prefer to deploy client and server separately:

**Option A: Deploy only client to Vercel**
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```
Then configure project root as `client/` in Vercel settings.

**Option B: Deploy server to separate service**
Keep API on different platform (Railway, Fly.io, Render, etc.)

## Troubleshooting

### Build Still Fails: "vite: command not found"
1. Clear Vercel build cache: Settings → Git → Redeploy (click dropdown) → Clear Build Cache
2. Check that `client/package.json` has vite in devDependencies
3. Verify no syntax errors in `vercel.json` (validate JSON online)

### Environment Variables Not Working
1. Verify variables are set in Vercel project settings (Environment)
2. Ensure variable names start with `VITE_` (required by Vite)
3. Redeploy after adding/changing env vars

### Rewrite Routes Not Working
Check browser network tab to see actual file served. Should be:
- `/` → serves `index.html`
- `/foo/bar` → serves `index.html` (SPA routing)
- `/api/something` → proxies to `api/something`

---

**File Changed:** `vercel.json`  
**Status:** Ready for redeploy  
**Expected Duration:** 2-3 minutes

---
