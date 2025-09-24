// -----------------------------------------------------------------------------
// Instagram Bot — Ultra-Safe Anti-Detection Mode (3–5 posts/day)
// Videos from API & local media, with credit to creators
// Advanced human-like patterns to avoid detection
// -----------------------------------------------------------------------------
// Node: >= 18 (uses built-in fetch), ESM module
// -----------------------------------------------------------------------------

import fs from "fs";
import path from "path";
import express from "express";
import dotenv from "dotenv";
import { IgApiClient } from "instagram-private-api";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import os from "os";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------- Config ----------------------------------------
const USERNAME = process.env.IG_USERNAME;
const PASSWORD = process.env.IG_PASSWORD;

const API_ACCOUNTS =
  (process.env.API_ACCOUNTS || "aircommittee3,fuzionmas,scorchmag,yardmascarnival")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const PLACEHOLDER_IMG = path.resolve(
  process.env.PLACEHOLDER_IMG || path.join(__dirname, "placeholder.jpg")
);
const SESSION_FILE = path.resolve(
  process.env.SESSION_FILE || path.join(__dirname, "session.json")
);
const SEEN_FILE = path.resolve(
  process.env.SEEN_FILE || path.join(__dirname, "seen.json")
);

const DEFAULT_IMMEDIATE_CAPTION =
  process.env.IMMEDIATE_CAPTION || "🔥 Fresh carnival content!";
const DEFAULT_SCHEDULED_CAPTION =
  process.env.SCHEDULED_CAPTION || "🎭 Carnival vibes!";

const CARNIVAL_HASHTAGS = [
  "#TrinidadCarnival", "#CaribbeanCarnival", "#CarnivalVibes", "#Masquerade", "#Fete",
  "#CarnivalLife", "#CarnivalSpirit", "#CarnivalSeason", "#MasBand", "#Costume",
  "#Steelpan", "#SocaMusic", "#Calypso", "#Dancehall", "#CaribbeanCulture",
  "#IslandVibes", "#TropicalVibes", "#WestIndianCulture", "#CaribbeanLife", "#IslandLife",
  "#Carnival2024", "#Carnival2025", "#CarnivalParty", "#RoadMarch", "#Jouvert",
  "#CarnivalDancer", "#CarnivalCostume", "#Soca", "#CaribbeanMusic", "#TriniCulture",
  "#WestIndianHeritage", "#CaribbeanHeritage", "#CarnivalTradition", "#Masquerader",
  "#CarnivalFeathers", "#CarnivalMakeup", "#CarnivalDance", "#SocaParty", "#FeteLife"
];

const POSTS_PER_DAY = () => Math.floor(Math.random() * 3) + 3; // 3–5/day
const MIN_DELAY_BETWEEN_ACTIONS = 60000;
const MAX_DELAY_BETWEEN_ACTIONS = 300000;
const PORT = Number(process.env.PORT || 3000);

const PRIORITIZE_LOCAL_MEDIA = true;
const LOCAL_MEDIA_USAGE_LIMIT = 2;

// ----------------------------- Media directory -------------------------------
let ACTIVE_MEDIA_DIR;
try {
  if (process.env.RENDER) {
    ACTIVE_MEDIA_DIR = path.join(os.tmpdir(), "localMedia");
  } else {
    ACTIVE_MEDIA_DIR = path.join(__dirname, "localMedia");
  }
  if (!fs.existsSync(ACTIVE_MEDIA_DIR))
    fs.mkdirSync(ACTIVE_MEDIA_DIR, { recursive: true });
} catch (error) {
  console.error("❌ Cannot create/access media directory:", error.message);
  ACTIVE_MEDIA_DIR = __dirname;
}

// ----------------------------- Globals ---------------------------------------
const ig = new IgApiClient();
let seenState = { lastCleared: Date.now(), ids: [] };
let seenSet = new Set();
let localMediaUsage = {};

// ----------------------------- Utilities -------------------------------------
function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath))
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.warn(e);
  }
  return fallback;
}
function saveJSON(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn(e);
  }
}
function loadSeen() {
  seenState = loadJSON(SEEN_FILE, { lastCleared: Date.now(), ids: [] });
  seenSet = new Set(seenState.ids || []);
}
function persistSeen() {
  seenState.ids = Array.from(seenSet);
  saveJSON(SEEN_FILE, seenState);
}
function clearSeenPostsIfNeeded() {
  const now = Date.now(),
    TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  if (now - (seenState.lastCleared || 0) > TWO_DAYS) {
    seenSet.clear();
    seenState.lastCleared = now;
    persistSeen();
    console.log("🧹 Cleared seen post IDs");
  }
}
function fmtTime(d) {
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour12: true,
  });
}
function isVideoFile(f) {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(f);
}
function getRandomHashtags(count = 8) {
  const shuffled = [...CARNIVAL_HASHTAGS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join(" ");
}
function generateCaption(baseCaption, sourceUsername, isApiContent = false) {
  let caption = baseCaption;
  if (isApiContent && sourceUsername) {
    caption += `\n\n🎥 Credit: @${sourceUsername}\n📌 Follow for daily carnival content!`;
  } else {
    caption += `\n\n📌 Follow @${USERNAME} for daily carnival content!`;
  }
  caption += `\n\n#CarnivalCompanion ${getRandomHashtags(8)}`;
  return caption;
}
function varyCaptionAdvanced(baseCaption, sourceUsername) {
  const variations = [
    { prefix: "Loving the energy in this! ", emoji: "🔥" },
    { prefix: "The vibes are incredible! ", emoji: "💃" },
    { prefix: "This made my day! ", emoji: "✨" },
    { prefix: "Can't get enough of this! ", emoji: "🎭" },
    { prefix: "The culture is beautiful! ", emoji: "🌟" },
    { prefix: "", emoji: "📸" },
    { prefix: "Wow! ", emoji: "🎉" },
    { prefix: "Incredible moment! ", emoji: "🙌" },
  ];
  const v = variations[Math.floor(Math.random() * variations.length)];
  let newCaption = baseCaption;
  if (Math.random() < 0.6) newCaption = v.prefix + newCaption;
  newCaption = v.emoji + " " + newCaption;
  if (Math.random() < 0.3) {
    const locs = ["Trinidad", "Caribbean", "West Indies", "Island Life"];
    newCaption +=
      " " + locs[Math.floor(Math.random() * locs.length)] + " vibes!";
  }
  return generateCaption(newCaption, sourceUsername, sourceUsername !== null);
}
async function randomDelay(
  minMs = MIN_DELAY_BETWEEN_ACTIONS,
  maxMs = MAX_DELAY_BETWEEN_ACTIONS
) {
  const delayMs = Math.random() * (maxMs - minMs) + minMs;
  console.log(`⏳ Delaying for ${Math.round(delayMs / 1000)} seconds...`);
  await new Promise((r) => setTimeout(r, delayMs));
}
function trackLocalMediaUsage(filename) {
  if (!localMediaUsage[filename]) localMediaUsage[filename] = 0;
  localMediaUsage[filename]++;
  if (localMediaUsage[filename] >= LOCAL_MEDIA_USAGE_LIMIT) {
    try {
      const filePath = path.join(ACTIVE_MEDIA_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted local media: ${filename}`);
        delete localMediaUsage[filename];
      }
    } catch (e) {
      console.error(e);
    }
  }
}
function getRandomLocalVideo() {
  try {
    const files = fs.readdirSync(ACTIVE_MEDIA_DIR).filter(isVideoFile);
    if (files.length === 0) return null;
    const available = files.filter(
      (f) =>
        !localMediaUsage[f] || localMediaUsage[f] < LOCAL_MEDIA_USAGE_LIMIT
    );
    if (available.length === 0) return null;
    const file = available[Math.floor(Math.random() * available.length)];
    trackLocalMediaUsage(file);
    return path.join(ACTIVE_MEDIA_DIR, file);
  } catch (e) {
    console.error(e);
    return null;
  }
}

// ----------------------------- Instagram login -------------------------------
async function saveSession() {
  const serialized = await ig.state.serialize();
  delete serialized.constants;
  saveJSON(SESSION_FILE, serialized);
  console.log("🔒 Session saved at", new Date().toLocaleString());
}
async function ultraSafeLogin() {
  console.log("🔐 Forced fresh login initiated...");
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("🗑️ Old session file deleted");
  }
  ig.state.generateDevice(USERNAME);
  await randomDelay(10000, 20000);
  await ig.account.login(USERNAME, PASSWORD);
  await saveSession();
  console.log("✅ Fresh login confirmed for", USERNAME);
}

// ----------------------------- Posting logic ---------------------------------
async function postVideoFromLocalOrApi(isStartup = false) {
  let videoPath = null;
  let caption = "";

  if (PRIORITIZE_LOCAL_MEDIA) {
    videoPath = getRandomLocalVideo();
    if (videoPath) {
      caption = varyCaptionAdvanced(
        isStartup ? DEFAULT_IMMEDIATE_CAPTION : DEFAULT_SCHEDULED_CAPTION,
        null
      );
      console.log("📤 Ready to post local video:", videoPath);
    }
  }

  if (!videoPath) {
    console.log("🔍 Fetching videos directly from API accounts...");
    try {
      const account = API_ACCOUNTS[Math.floor(Math.random() * API_ACCOUNTS.length)];
      const userSearch = await ig.user.searchExact(account);
      const userFeed = ig.feed.user(userSearch.pk);
      const items = await userFeed.items();
      const videoItem = items.find((i) => i.video_versions);

      if (videoItem) {
        videoPath = videoItem.video_versions[0].url;
        caption = varyCaptionAdvanced(
          isStartup ? DEFAULT_IMMEDIATE_CAPTION : DEFAULT_SCHEDULED_CAPTION,
          account
        );
        console.log("📤 Ready to post API video from @" + account);
      }
    } catch (err) {
      console.error("❌ Fetch failed:", err.message);
    }
  }

  if (!videoPath) {
    console.log("🖼️ Using placeholder as fallback");
    videoPath = PLACEHOLDER_IMG;
    caption = DEFAULT_SCHEDULED_CAPTION;
  }

  try {
    await ig.publish.video({
      video: fs.createReadStream(videoPath),
      caption,
    });
    console.log("✅ Post published successfully at", new Date().toLocaleTimeString());
  } catch (err) {
    console.error("❌ Failed to publish media:", err.message);
  }
}

// ----------------------------- Scheduler -------------------------------------
async function scheduler() {
  clearSeenPostsIfNeeded();
  loadSeen();
  console.log("📅 Generating posts for today...");

  const numPosts = POSTS_PER_DAY();
  console.log(`📅 Today’s schedule: ${numPosts} posts`);

  for (let i = 0; i < numPosts; i++) {
    await randomDelay(3 * 60 * 60 * 1000, 5 * 60 * 60 * 1000); // 3–5 hrs
    console.log(`🚀 Preparing post ${i + 1} of ${numPosts}`);
    await postVideoFromLocalOrApi();
  }
}

// ----------------------------- Startup ---------------------------------------
(async () => {
  try {
    await ultraSafeLogin();
    console.log("🚀 Making immediate startup post...");
    await postVideoFromLocalOrApi(true);
    await scheduler();
  } catch (e) {
    console.error("❌ Fatal error:", e.message);
  }
})();

// ----------------------------- Keep alive ------------------------------------
const app = express();
app.get("/", (req, res) => res.send("✅ Instagram bot running"));
app.listen(PORT, () =>
  console.log(`🌐 Server running on port ${PORT}`)
);
