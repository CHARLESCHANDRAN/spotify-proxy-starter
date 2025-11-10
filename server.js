/**
 * Spotify Proxy (Client Credentials)
 * Deploy this server and set SPOTIFY_PROXY_BASE in your mobile app.
 * Never expose SPOTIFY_CLIENT_SECRET in your mobile app.
 *
 * Requires deps:
 *  - express
 *  - node-fetch@^2
 *  - cors
 *  - express-rate-limit
 *  - dotenv
 *
 * package.json hints:
 *  "main": "server.js",
 *  "engines": { "node": ">=18" },
 *  "scripts": { "start": "node server.js" }
 */

const express = require("express");
const fetch = require("node-fetch"); // v2
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
app.use(express.json());

// ---- Version (bump when you redeploy) ----
const VERSION = "reco-verbose-2025-11-10";

// ---- CORS (tighten ALLOWED_ORIGINS in production) ----
app.use(
	cors({
		origin: process.env.ALLOWED_ORIGINS
			? process.env.ALLOWED_ORIGINS.split(",")
			: "*",
	})
);

// ---- Basic rate limiting ----
const limiter = rateLimit({
	windowMs: 60 * 1000,
	max: parseInt(process.env.RATE_LIMIT_MAX || "120", 10),
});
app.use(limiter);

// ---- Constants ----
const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

// ---- In-memory token cache ----
let cachedToken = { access_token: null, expires_at: 0 };

async function getAppToken() {
	const now = Math.floor(Date.now() / 1000);
	if (cachedToken.access_token && cachedToken.expires_at > now + 30) {
		return cachedToken.access_token;
	}

	const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
	if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
		throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET");
	}

	const auth = Buffer.from(
		SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET
	).toString("base64");

	const res = await fetch(`${ACCOUNTS}/api/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${auth}`,
		},
		body: "grant_type=client_credentials",
	});

	if (!res.ok) {
		const t = await res.text();
		throw new Error("Spotify token error: " + t);
	}

	const data = await res.json();
	cachedToken = {
		access_token: data.access_token,
		expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
	};
	return cachedToken.access_token;
}

// ---- Generic forwarder for simple GET endpoints ----
async function forward(res, url) {
	try {
		const token = await getAppToken();
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});

		const text = await r.text();
		res.status(r.status);

		const ct = r.headers.get("content-type") || "";
		if (ct.includes("application/json")) res.type("application/json");
		else res.type("text/plain");

		res.send(text);
	} catch (e) {
		res.status(500).json({ error: String(e) });
	}
}

// -------------------------------------------------------
// Health (shows version)
// -------------------------------------------------------
app.get("/api/spotify/health", (req, res) =>
	res.json({ ok: true, version: VERSION, time: new Date().toISOString() })
);

// -------------------------------------------------------
// Search
// -------------------------------------------------------
app.get("/api/spotify/search", async (req, res) => {
	const q = req.query.q || "";
	const type = req.query.type || "track,artist,album";
	const market = req.query.market
		? `&market=${encodeURIComponent(req.query.market)}`
		: "";
	const limit = req.query.limit
		? `&limit=${encodeURIComponent(req.query.limit)}`
		: "";

	const url = `${API}/search?q=${encodeURIComponent(
		q
	)}&type=${encodeURIComponent(type)}${market}${limit}`;

	await forward(res, url);
});

// -------------------------------------------------------
// Available genre seeds (helper)
// -------------------------------------------------------
app.get("/api/spotify/available-genre-seeds", async (req, res) => {
	try {
		const token = await getAppToken();
		const r = await fetch(`${API}/recommendations/available-genre-seeds`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		const data = await r.json();
		res.status(r.status).json(data);
	} catch (e) {
		res.status(500).json({ error: String(e) });
	}
});

// -------------------------------------------------------
// Recommendations (with graceful fallback for 404/403)
// -------------------------------------------------------
app.get("/api/spotify/recommendations", async (req, res) => {
	try {
		const token = await getAppToken();

		const splitCSV = (v) =>
			!v
				? []
				: String(v)
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);

		let artistsArr = splitCSV(req.query.seed_artists);
		let tracksArr = splitCSV(req.query.seed_tracks);
		let genresArr = splitCSV(req.query.seed_genres);

		// If no seeds provided, safe defaults
		if (artistsArr.length + tracksArr.length + genresArr.length === 0) {
			genresArr = ["pop", "rock", "hip-hop"]; // valid genre slugs
		}

		// Enforce ≤5 seeds
		let remaining = 5;
		artistsArr = artistsArr.slice(0, remaining);
		remaining -= artistsArr.length;
		tracksArr = tracksArr.slice(0, remaining);
		remaining -= tracksArr.length;
		genresArr = genresArr.slice(0, remaining);

		// Build params for the official endpoint
		const params = new URLSearchParams();
		if (artistsArr.length) params.set("seed_artists", artistsArr.join(","));
		if (tracksArr.length) params.set("seed_tracks", tracksArr.join(","));
		if (genresArr.length) params.set("seed_genres", genresArr.join(","));

		const limit = Math.min(
			Math.max(parseInt(req.query.limit || "20", 10) || 20, 1),
			100
		);
		params.set("limit", String(limit));
		params.set("market", (req.query.market || "US").toString());

		const tunables = [
			"target_acousticness",
			"target_danceability",
			"target_energy",
			"target_instrumentalness",
			"target_liveness",
			"target_loudness",
			"target_speechiness",
			"target_tempo",
			"target_valence",
			"min_acousticness",
			"max_acousticness",
			"min_danceability",
			"max_danceability",
			"min_energy",
			"max_energy",
			"min_instrumentalness",
			"max_instrumentalness",
			"min_liveness",
			"max_liveness",
			"min_loudness",
			"max_loudness",
			"min_popularity",
			"max_popularity",
			"min_speechiness",
			"max_speechiness",
			"min_tempo",
			"max_tempo",
			"min_valence",
			"max_valence",
		];
		for (const p of tunables) {
			const v = req.query[p];
			if (v !== undefined && v !== null && String(v).trim() !== "")
				params.set(p, String(v));
		}

		const officialUrl = `${API}/recommendations?${params.toString()}`;
		const r = await fetch(officialUrl, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
		});

		// If official endpoint works, return it
		if (r.ok) {
			const data = await r.json();
			return res.json(data);
		}

		// If 404/403 → graceful fallback for newer apps / restricted access
		if (r.status === 404 || r.status === 403) {
			console.warn(
				"[reco] Falling back (status =",
				r.status,
				") url:",
				officialUrl
			);

			// Fallback strategy:
			// - If artist seeds: gather each artist's top tracks
			// - Else if genre seeds: do track search per genre (genre:"...") and merge
			// - Else try a generic popular search
			const collected = [];
			const seen = new Set();

			const pushUnique = (track) => {
				if (!track || !track.id || seen.has(track.id)) return;
				seen.add(track.id);
				collected.push(track);
			};

			// 1) Artist seeds → top tracks
			for (const artistId of artistsArr) {
				try {
					const topUrl = `${API}/artists/${encodeURIComponent(
						artistId
					)}/top-tracks?market=${params.get("market")}`;
					const tr = await fetch(topUrl, {
						headers: { Authorization: `Bearer ${token}` },
					});
					if (tr.ok) {
						const tj = await tr.json();
						(tj.tracks || []).forEach(pushUnique);
					}
				} catch {}
				if (collected.length >= limit) break;
			}

			// 2) Genre seeds → search tracks by genre
			if (collected.length < limit && genresArr.length) {
				for (const g of genresArr) {
					try {
						// Spotify Search supports genre filter in queries
						const q = `genre:"${g}"`;
						const searchUrl = `${API}/search?q=${encodeURIComponent(
							q
						)}&type=track&market=${params.get("market")}&limit=${Math.min(
							50,
							limit
						)}`;
						const sr = await fetch(searchUrl, {
							headers: { Authorization: `Bearer ${token}` },
						});
						if (sr.ok) {
							const sj = await sr.json();
							(sj.tracks?.items || []).forEach(pushUnique);
						}
					} catch {}
					if (collected.length >= limit) break;
				}
			}

			// 3) Track seeds → include the seed tracks themselves (plus any found by artist/genre)
			if (collected.length < limit && tracksArr.length) {
				for (const tid of tracksArr) {
					try {
						const tUrl = `${API}/tracks/${encodeURIComponent(tid)}`;
						const tr = await fetch(tUrl, {
							headers: { Authorization: `Bearer ${token}` },
						});
						if (tr.ok) {
							const tj = await tr.json();
							pushUnique(tj);
						}
					} catch {}
					if (collected.length >= limit) break;
				}
			}

			// Trim to requested limit and return in the same shape as /recommendations
			return res.json({ tracks: collected.slice(0, limit) });
		}

		// Other errors: bubble up details for debugging
		let bodyText = await r.text();
		let bodyJson = null;
		try {
			bodyJson = bodyText ? JSON.parse(bodyText) : null;
		} catch {}
		const errorPayload = bodyJson ?? (bodyText || "(empty body)");
		console.error(
			"[reco] Upstream error",
			r.status,
			errorPayload,
			"url:",
			officialUrl
		);
		return res.status(r.status).json({
			error: "Upstream Spotify error",
			status: r.status,
			upstream: errorPayload,
			url: officialUrl,
		});
	} catch (e) {
		console.error("[reco] Handler error:", e);
		res.status(500).json({ error: String(e) });
	}
});

// -------------------------------------------------------
// Tracks / Artists / Albums (simple forwards)
// -------------------------------------------------------
app.get("/api/spotify/tracks/:id", async (req, res) => {
	const url = `${API}/tracks/${encodeURIComponent(req.params.id)}`;
	await forward(res, url);
});

app.get("/api/spotify/artists/:id", async (req, res) => {
	const url = `${API}/artists/${encodeURIComponent(req.params.id)}`;
	await forward(res, url);
});

app.get("/api/spotify/albums/:id", async (req, res) => {
	const url = `${API}/albums/${encodeURIComponent(req.params.id)}`;
	await forward(res, url);
});

// -------------------------------------------------------
// Start
// -------------------------------------------------------
const port = process.env.PORT || 8080;
app.listen(port, () => {
	console.log(`Spotify proxy listening on :${port}`);
});
