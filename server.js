/**
 * Spotify Proxy (Client Credentials)
 * Deploy this server and set SPOTIFY_PROXY_BASE in your mobile app.
 * Never expose SPOTIFY_CLIENT_SECRET in your mobile app.
 *
 * Requires (example package.json deps):
 *  - express
 *  - node-fetch@^2
 *  - cors
 *  - express-rate-limit
 *  - dotenv
 */

const express = require("express");
const fetch = require("node-fetch"); // v2
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
app.use(express.json());

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

// Generic forwarder for simple GET endpoints
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
// Health
// -------------------------------------------------------
app.get("/api/spotify/health", (req, res) =>
	res.json({ ok: true, time: new Date().toISOString() })
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
// Recommendations (with safe defaults & 5-seed cap)
// -------------------------------------------------------
app.get("/api/spotify/recommendations", async (req, res) => {
	try {
		const token = await getAppToken();

		// Collect seeds
		const seedArtists = (req.query.seed_artists || "").toString().trim();
		const seedTracks = (req.query.seed_tracks || "").toString().trim();
		const seedGenres = (req.query.seed_genres || "").toString().trim();

		const artistsArr = seedArtists
			? seedArtists
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
		const tracksArr = seedTracks
			? seedTracks
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
		const genresArr = seedGenres
			? seedGenres
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [];

		// Fallback if no seeds provided (use valid genre slugs)
		if (artistsArr.length + tracksArr.length + genresArr.length === 0) {
			genresArr.push("pop", "rock", "hip-hop");
		}

		// Enforce ≤5 total seeds
		const takeUpTo = (arr, remaining) => arr.slice(0, Math.max(0, remaining));
		let remaining = 5;
		const a = takeUpTo(artistsArr, remaining);
		remaining -= a.length;
		const t = takeUpTo(tracksArr, remaining);
		remaining -= t.length;
		const g = takeUpTo(genresArr, remaining);

		const params = new URLSearchParams();
		if (a.length) params.set("seed_artists", a.join(","));
		if (t.length) params.set("seed_tracks", t.join(","));
		if (g.length) params.set("seed_genres", g.join(","));

		// Tunable attributes
		const tunableParams = [
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
		for (const p of tunableParams) {
			const v = req.query[p];
			if (v !== undefined && v !== null && v !== "") {
				params.set(p, String(v));
			}
		}

		// Limit (1–100)
		const limit = Math.min(
			Math.max(parseInt(req.query.limit || "20", 10) || 20, 1),
			100
		);
		params.set("limit", String(limit));

		// Market (optional, e.g., US)
		if (req.query.market) params.set("market", String(req.query.market));

		const url = `${API}/recommendations?${params.toString()}`;
		const r = await fetch(url, {
			headers: { Authorization: `Bearer ${token}` },
		});

		if (!r.ok) {
			const errorText = await r.text();
			return res.status(r.status).json({ error: errorText });
		}

		const data = await r.json();
		res.json(data);
	} catch (e) {
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
