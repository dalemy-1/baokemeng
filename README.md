# ops-sync-api (Vercel)

## Environment Variables (Vercel Project Settings -> Environment Variables)
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- ADMIN_SYNC_TOKEN  (your own strong token)

## Endpoints
- GET  /api/sync/pull
- POST /api/sync/push
- GET  /api/sync/ping

All requests must include header:
- x-admin-token: <ADMIN_SYNC_TOKEN>

CORS is enabled (Access-Control-Allow-Origin: *) for file:// and GitHub Pages usage.
