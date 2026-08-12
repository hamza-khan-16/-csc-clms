# Deploying to Vercel

## One-time setup

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Import to Vercel
1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repository
3. Framework preset: **Other** (leave as-is — vercel.json handles it)
4. Click **Deploy** — it will fail on first deploy until env vars are added (step 3)

### 3. Add Environment Variables
In Vercel → Your Project → **Settings → Environment Variables**, add all of these:

| Variable | Where to find it | Expose to browser? |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | No |
| `VITE_SUPABASE_URL` | Same value as above | Yes (VITE_ prefix) |
| `SUPABASE_PROJECT_ID` | Supabase → Project Settings → API | No |
| `VITE_SUPABASE_PROJECT_ID` | Same value as above | Yes |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → anon key | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Same value as above | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role key | **Never** — server only |
| `VITE_GROQ_API_KEY` | [console.groq.com](https://console.groq.com) (free) | Yes |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` must NEVER be exposed. Only add it without the `VITE_` prefix.

### 4. Redeploy
After adding env vars, go to **Deployments → Redeploy**.

---

## Supabase CORS & Auth settings

In Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://your-project.vercel.app`
- **Redirect URLs**: add `https://your-project.vercel.app/**`

---

## Local development
```bash
cp .env.example .env
# Fill in your values in .env
npm install
npm run dev
```
