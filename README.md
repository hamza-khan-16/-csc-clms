# CSC Leave Management System

## Run locally (3 steps)

```bash
# 1. Install dependencies
npm install

# 2. Apply new Supabase migrations (run in order)
#    Go to: https://supabase.com/dashboard/project/odnmbwgtsjcpecfrjfsv/sql/new
#    Paste and run each file in supabase/migrations/ starting with 20260730000001_*
#    then 20260730000002_* then 20260730000003_*

# 3. Start the dev server
npm run dev
```

The app runs at http://localhost:3000

## Environment
The `.env` file is pre-configured with the Supabase project credentials.
