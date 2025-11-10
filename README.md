# Spotify Proxy Starter

A minimal Express proxy for the Spotify Web API using **Client Credentials**. Use this with a mobile app via an env var like:
```
SPOTIFY_PROXY_BASE=https://your-deployment.example.com/api/spotify
```

> ⚠️ Never ship your Spotify Client Secret in a mobile app.

## Endpoints
- `GET /api/spotify/health`
- `GET /api/spotify/search?q=believer&type=track,artist,album&limit=10`
- `GET /api/spotify/tracks/:id`
- `GET /api/spotify/artists/:id`
- `GET /api/spotify/albums/:id`

## Local setup
```bash
git clone <this repo>
cd spotify-proxy-starter
cp .env.example .env
# fill SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
npm i
npm run dev
# http://localhost:8080/api/spotify/health
```

## Deploy (Render - simple)
1. Push this folder to a GitHub repo.
2. Create a **Web Service** on https://render.com → connect repo.
3. Build command: `npm i`
4. Start command: `npm start`
5. Env Vars: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, optionally `ALLOWED_ORIGINS`, `RATE_LIMIT_MAX`.
6. After deploy, note your URL: `https://<service>.onrender.com`
7. In your app: `SPOTIFY_PROXY_BASE=https://<service>.onrender.com/api/spotify`

## Deploy (Vercel - server)
1. Create a new Vercel project and import your repo.
2. Framework preset: **Other**.
3. Add Env Vars.
4. Set **Build & Output Settings** → Output: **Server**.
5. Deploy. Your URL will look like `https://<project>.vercel.app`.

## Mobile app usage
```js
const base = process.env.SPOTIFY_PROXY_BASE; // e.g., https://<service>.onrender.com/api/spotify

export async function searchSpotify(q) {
  const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&type=track,artist,album`);
  if (!res.ok) throw new Error("Spotify search failed");
  return res.json();
}
```

## Notes
- This proxy uses **Client Credentials** → works for public data (search, tracks, artists, albums). For user-specific scopes (playlists, library, playback), implement Authorization Code with PKCE on the server.
- Lock down `ALLOWED_ORIGINS` when you deploy.
- Consider adding caching (e.g., `Cache-Control` headers) if you need higher throughput.
