/**
 * Spotify Proxy (Client Credentials)
 * Deploy this server and set SPOTIFY_PROXY_BASE in your mobile app.
 */
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
app.use(express.json());

// CORS: lock to your domains in production
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",") : "*"
}));

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || "120"),
});
app.use(limiter);

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

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
  const auth = Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64");
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`
    },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Spotify token error: " + t);
  }
  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + data.expires_in
  };
  return cachedToken.access_token;
}

async function forward(res, url) {
  try {
    const token = await getAppToken();
    const r = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
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

// Health
app.get("/api/spotify/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Search
app.get("/api/spotify/search", async (req, res) => {
  const q = req.query.q || "";
  const type = req.query.type || "track,artist,album";
  const market = req.query.market ? `&market=${encodeURIComponent(req.query.market)}` : "";
  const limit = req.query.limit ? `&limit=${encodeURIComponent(req.query.limit)}` : "";
  const url = `${API}/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}${market}${limit}`;
  await forward(res, url);
});

// Tracks
app.get("/api/spotify/tracks/:id", async (req, res) => {
  const url = `${API}/tracks/${encodeURIComponent(req.params.id)}`;
  await forward(res, url);
});

// Artists
app.get("/api/spotify/artists/:id", async (req, res) => {
  const url = `${API}/artists/${encodeURIComponent(req.params.id)}`;
  await forward(res, url);
});

// Albums
app.get("/api/spotify/albums/:id", async (req, res) => {
  const url = `${API}/albums/${encodeURIComponent(req.params.id)}`;
  await forward(res, url);
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Spotify proxy listening on :${port}`);
});
