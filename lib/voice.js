const crypto = require("crypto");

// Server-side text-to-speech via ElevenLabs. We keep the API key on the server
// and expose audio to the browser through our own /api/tts route, so the key is
// never shipped to the client. ElevenLabs returns MP3 bytes which the browser
// plays with a plain <audio> element.
const API_KEY = process.env.ELEVENLABS_API || process.env.ELEVENLABS_API_KEY || "";
// eleven_turbo_v2_5 is ElevenLabs' recommended real-time model: near-instant
// generation (vs. the slower multilingual_v2) while still sounding natural. For
// a live call the low latency matters as much as the timbre, and the frontend
// pipelines/pre-buffers each line so the small remaining delay is hidden.
const MODEL_ID = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";

// Two distinct, modern *conversational* ElevenLabs voices (not the dated 2023
// Rachel/Adam) so the rep and the simulated customer sound like real, different
// people. Override per deployment via env if you like.
const VOICES = {
  agent: process.env.ELEVENLABS_VOICE_AGENT || "cjVigY5qzO86Huf0OWal", // Eric — smooth, trustworthy, conversational
  customer: process.env.ELEVENLABS_VOICE_CUSTOMER || "cgSgspJ2msm6clMCkdW9" // Jessica — warm, conversational
};

function isEnabled() {
  return Boolean(API_KEY);
}

function resolveVoiceId(role) {
  // Accept either a role name ("agent"/"customer") or a raw ElevenLabs voice id.
  return VOICES[role] || role || VOICES.agent;
}

// ElevenLabs bills per character, and the same lines (openings, replays) recur,
// so we cache rendered audio by an exact hash of what produced it.
const cache = new Map(); // key -> Buffer
const MAX_CACHE = 200;

function cacheKey(voiceId, text) {
  return crypto.createHash("sha1").update(`${MODEL_ID}|${voiceId}|${text}`).digest("hex");
}

function remember(key, buffer) {
  cache.set(key, buffer);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); // evict oldest
}

// Returns a Buffer of MP3 audio for the given text + voice role. Throws on a
// misconfigured key or an ElevenLabs error so the route can surface it.
async function synthesize(text, role = "agent") {
  if (!API_KEY) throw new Error("ELEVENLABS_API is not set");
  const clean = String(text || "").trim();
  if (!clean) throw new Error("No text to speak");

  const voiceId = resolveVoiceId(role);
  const key = cacheKey(voiceId, clean);
  if (cache.has(key)) return cache.get(key);

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text: clean,
      model_id: MODEL_ID,
      // Tuned for natural conversation. Moderate stability keeps delivery steady
      // without going monotone; a light touch of style adds life; we keep style
      // well under ~0.4 because higher values are what introduce the "weird",
      // artifacty pitch swings. speaker_boost firms up the timbre.
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true }
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  remember(key, buffer);
  return buffer;
}

module.exports = { synthesize, isEnabled, MODEL_ID, VOICES };
