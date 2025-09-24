// -----------------------------------------------------------------------------
// Instagram Bot — Ultra-Safe Anti-Detection Mode (3-5 posts/day)
// Videos only from API & local media, with credit to original creators
// Advanced human-like behavior patterns to avoid detection
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------- .env / config ---------------------------------
dotenv.config();

const USERNAME = process.env.IG_USERNAME;
const PASSWORD = process.env.IG_PASSWORD;

const API_ACCOUNTS =
  (process.env.API_ACCOUNTS || "aircommittee3,fuzionmas,scorchmag,yardmascarnival")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Placeholder if API + local fail (should be an image)
const PLACEHOLDER_IMG = path.resolve(process.env.PLACEHOLDER_IMG || path.join(__dirname, "placeholder.jpg"));
// Session state (persist login)
const SESSION_FILE = path.resolve(process.env.SESSION_FILE || path.join(__dirname, "session.json"));
// Seen post IDs store (so we don't re-use API posts too soon)
const SEEN_FILE = path.resolve(process.env.SEEN_FILE || path.join(__dirname, "seen.json"));
// Local media usage tracking
const LOCAL_USAGE_FILE = path.resolve(__dirname, "local_media_usage.json");

// Caption defaults
const DEFAULT_IMMEDIATE_CAPTION =
  process.env.IMMEDIATE_CAPTION || "🔥 Fresh carnival content!";
const DEFAULT_SCHEDULED_CAPTION =
  process.env.SCHEDULED_CAPTION || "🎭 Carnival vibes!";

// Popular carnival and West Indian hashtags (randomly selected)
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

// Ultra-safe posting frequency (3-5 posts per day)
const POSTS_PER_DAY = () => Math.floor(Math.random() * 3) + 3; // 3–5 random posts

// Extended delays for anti-detection
const MIN_DELAY_BETWEEN_ACTIONS = 60000; // 1 minute minimum
const MAX_DELAY_BETWEEN_ACTIONS = 300000; // 5 minutes maximum

// Keep-alive HTTP port (Render provides PORT)
const PORT = Number(process.env.PORT || 3000);

// ----------------------------- Configuration ---------------------------------
const PRIORITIZE_LOCAL_MEDIA = true; // Set to true to use local videos first
const LOCAL_MEDIA_USAGE_LIMIT = 2; // Delete local files after this many posts

// ------------------------------- Guards --------------------------------------
if (!USERNAME || !PASSWORD) {
  console.error("❌ Missing environment variables. Set IG_USERNAME, IG_PASSWORD.");
  process.exit(1);
}

// FIXED: Render-compatible directory handling
let ACTIVE_MEDIA_DIR;
try {
  if (process.env.RENDER) {
    ACTIVE_MEDIA_DIR = path.join(os.tmpdir(), "localMedia");
    console.log(`🌐 Render environment detected, using temp directory: ${ACTIVE_MEDIA_DIR}`);
  } else {
    ACTIVE_MEDIA_DIR = path.join(__dirname, "localMedia");
    console.log(`💻 Local environment, using directory: ${ACTIVE_MEDIA_DIR}`);
  }

  if (!fs.existsSync(ACTIVE_MEDIA_DIR)) {
    console.log(`📁 Creating media directory: ${ACTIVE_MEDIA_DIR}`);
    fs.mkdirSync(ACTIVE_MEDIA_DIR, { recursive: true });
    console.log("✅ Media directory created successfully");
  }

  const files = fs.readdirSync(ACTIVE_MEDIA_DIR);
  console.log(`✅ Media directory accessible. Contains ${files.length} files:`, files);
} catch (error) {
  console.error("❌ Cannot create or access media directory:", error.message);
  ACTIVE_MEDIA_DIR = __dirname;
  console.log(`📁 Falling back to: ${ACTIVE_MEDIA_DIR}`);
}

// ------------------------------ Globals --------------------------------------
const ig = new IgApiClient();

let seenState = { lastCleared: Date.now(), ids: [] };
let seenSet = new Set();
let localMediaUsage = {};

// ------------------------------ Utilities ------------------------------------
function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    console.warn(`⚠️ Failed to read ${path.basename(filePath)}:`, e.message);
  }
  return fallback;
}

function saveJSON(filePath, obj) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.warn(`⚠️ Failed to write ${path.basename(filePath)}:`, e.message);
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
  const now = Date.now();
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  if (now - (seenState.lastCleared || 0) > TWO_DAYS) {
    seenSet.clear();
    seenState.lastCleared = now;
    persistSeen();
    console.log("🧹 Cleared seen post IDs (every 2 days)");
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

function isVideoFile(filename) {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(filename);
}

function getRandomHashtags(count = 8) {
  const shuffled = [...CARNIVAL_HASHTAGS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join(' ');
}

function generateCaption(baseCaption, sourceUsername, isApiContent = false) {
  let caption = baseCaption;

  if (isApiContent && sourceUsername) {
    caption += `\n\n🎥 Credit: @${sourceUsername}`;
    caption += `\n📌 Follow for daily carnival content!`;
  } else {
    caption += `\n\n📌 Follow @${USERNAME} for daily carnival content!`;
  }

  caption += `\n\n#CarnivalCompanion ${getRandomHashtags(8)}`;

  return caption;
}

function varyCaptionAdvanced(baseCaption, sourceUsername) {
  const emotionVariations = [
    { prefix: "Loving the energy in this! ", emoji: "🔥" },
    { prefix: "The vibes are incredible! ", emoji: "💃" },
    { prefix: "This made my day! ", emoji: "✨" },
    { prefix: "Can't get enough of this! ", emoji: "🎭" },
    { prefix: "The culture is beautiful! ", emoji: "🌟" },
    { prefix: "", emoji: "📸" },
    { prefix: "Wow! ", emoji: "🎉" },
    { prefix: "Incredible moment! ", emoji: "🙌" }
  ];

  const variation = emotionVariations[Math.floor(Math.random() * emotionVariations.length)];

  let newCaption = baseCaption;

  if (Math.random() < 0.6) newCaption = variation.prefix + newCaption;

  newCaption = variation.emoji + " " + newCaption;

  if (Math.random() < 0.3) {
    const locations = ["Trinidad", "Caribbean", "West Indies", "Island Life"];
    const location = locations[Math.floor(Math.random() * locations.length)];
    newCaption += ` ${location} vibes!`;
  }

  return generateCaption(newCaption, sourceUsername, sourceUsername !== null);
}

async function randomDelay(minMs = MIN_DELAY_BETWEEN_ACTIONS, maxMs = MAX_DELAY_BETWEEN_ACTIONS) {
  const delayMs = Math.random() * (maxMs - minMs) + minMs;
  console.log(`⏳ Delaying for ${Math.round(delayMs / 1000)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// Track and manage local media usage for deletion
function trackLocalMediaUsage(filename) {
  if (!localMediaUsage[filename]) localMediaUsage[filename] = 0;
  localMediaUsage[filename]++;
  console.log(`📊 Local media usage: ${filename} used ${localMediaUsage[filename]} times`);

  if (localMediaUsage[filename] >= LOCAL_MEDIA_USAGE_LIMIT) {
    try {
      const filePath = path.join(ACTIVE_MEDIA_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Deleted local media: ${filename} (used ${LOCAL_MEDIA_USAGE_LIMIT} times)`);
        delete localMediaUsage[filename];
      }
    } catch (error) {
      console.error(`❌ Failed to delete ${filename}:`, error.message);
    }
  }
}

function loadLocalMediaUsage() {
  localMediaUsage = loadJSON(LOCAL_USAGE_FILE, {});
}

function saveLocalMediaUsage() {
  saveJSON(LOCAL_USAGE_FILE, localMediaUsage);
}

// ------------------------------ Instagram login ------------------------------
async function saveSession() {
  const serialized = await ig.state.serialize();
  delete serialized.constants;
  saveJSON(SESSION_FILE, serialized);
  console.log("🔒 Session saved");
}

async function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    const state = loadJSON(SESSION_FILE, null);
    if (state) {
      await ig.state.deserialize(state);
      console.log("🔑 Session loaded from file");
      return true;
    }
  }
  return false;
}

async function ultraSafeLogin() {
  console.log("🔐 Ultra-safe login sequence initiated...");
  const initialDelay = Math.random() * 10000 + 10000; // 10-20 seconds
  console.log(`⏳ Delaying login for ${Math.round(initialDelay / 1000)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));

  ig.state.generateDevice(USERNAME);

  if (await loadSession()) {
    try {
      await Promise.race([
        ig.account.currentUser(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
      ]);
      console.log("🔑 Session verified successfully");
      return;
    } catch (e) {
      console.log("🔄 Session expired or invalid, re-logging in...");
    }
  }

  console.log("🔑 Performing fresh login...");
  await ig.account.login(USERNAME, PASSWORD);
  await saveSession();

  const postLoginDelay = Math.random() * 10000 + 5000; // 5-15 seconds
  console.log(`⏳ Post-login delay for ${Math.round(postLoginDelay / 1000)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, postLoginDelay));

  console.log("🔓 Login sequence completed safely");
}

// ------------------------------ Direct Instagram API fetch -------------------
async function fetchUserVideosDirectly(username) {
  try {
    console.log(`🔍 Fetching videos directly from @${username}...`);

    const userId = await ig.user.getIdByUsername(username);
    const userFeed = ig.feed.user(userId);

    let items = [];
    let hasMore = true;
    let attempt = 0;

    while (hasMore && items.length < 20 && attempt < 3) {
      attempt++;
      try {
        const page = await userFeed.items();
        items.push(...page);
        if (page.length === 0) hasMore = false;
        await randomDelay(2000, 5000);
      } catch (error) {
        console.error(`❌ Error fetching page ${attempt} for @${username}:`, error.message);
        hasMore = false;
      }
    }

    console.log(`📊 Found ${items.length} posts from @${username}`);

    const videoItems = items.filter(item => {
      const isVideo = item?.video_codec && item?.video_versions?.length > 0;
      const notSeen = !seenSet.has(item.id);
      return isVideo && notSeen;
    });

    console.log(`🎬 ${videoItems.length} unseen videos for posting`);

    return videoItems;
  } catch (e) {
    console.error("❌ Fetch failed:", e.message);
    return [];
  }
}

// ------------------------------ Local media ------------------------------
function getRandomLocalVideo() {
  try {
    const files = fs.readdirSync(ACTIVE_MEDIA_DIR).filter(isVideoFile);
    if (files.length === 0) return null;

    const availableFiles = files.filter(file => {
      const usageCount = localMediaUsage[file] || 0;
      return usageCount < LOCAL_MEDIA_USAGE_LIMIT;
    });

    if (availableFiles.length === 0) {
      console.log("📹 All local videos have reached usage limit");
      return null;
    }

    const file = availableFiles[Math.floor(Math.random() * availableFiles.length)];
    const filePath = path.join(ACTIVE_MEDIA_DIR, file);

    trackLocalMediaUsage(file);

    return filePath;
  } catch (e) {
    console.error("❌ Failed to read local media:", e.message);
    return null;
  }
}

// ------------------------------ Video utils ------------------------------
function extractVideoThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
        size: '640x640'
      })
      .on('end', () => {
        console.log(`✅ Thumbnail extracted: ${path.basename(thumbnailPath)}`);
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error(`❌ Failed to extract thumbnail from ${path.basename(videoPath)}:`, err.message);
        reject(err);
      });
  });
}

function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

function trimVideo(inputPath, outputPath, maxDuration) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setDuration(maxDuration)
      .output(outputPath)
      .on('end', () => {
        console.log(`✅ Video trimmed to ${maxDuration}s: ${path.basename(outputPath)}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error(`❌ Failed to trim video:`, err.message);
        reject(err);
      })
      .run();
  });
}

// ------------------------------ Main posting logic ----------------------------
async function makeSinglePost() {
  let mediaPath = null;
  let caption = DEFAULT_IMMEDIATE_CAPTION;
  let sourceUsername = null;
  let isVideo = false;

  if (PRIORITIZE_LOCAL_MEDIA) {
    mediaPath = getRandomLocalVideo();
    if (mediaPath) {
      console.log(`📹 Using local video: ${path.basename(mediaPath)}`);
      isVideo = true;
    }
  }

  if (!mediaPath) {
    const apiAccount = API_ACCOUNTS[Math.floor(Math.random() * API_ACCOUNTS.length)];
    const videos = await fetchUserVideosDirectly(apiAccount);
    if (videos.length > 0) {
      mediaPath = videos[0].video_versions[0].url;
      caption = varyCaptionAdvanced(DEFAULT_IMMEDIATE_CAPTION, apiAccount);
      sourceUsername = apiAccount;
      seenSet.add(videos[0].id);
      persistSeen();
      isVideo = true;
      console.log(`🌐 Using API video from @${apiAccount}`);
    }
  }

  if (!mediaPath) {
    mediaPath = PLACEHOLDER_IMG;
    caption = varyCaptionAdvanced(DEFAULT_IMMEDIATE_CAPTION, null);
    console.log("🖼️ Using placeholder image as fallback");
  }

  console.log(`📤 Ready to post: ${path.basename(mediaPath)}`);
  console.log(`📝 Caption: ${caption.substring(0, 100)}...`);

  await randomDelay(30000, 120000);

  try {
    if (isVideo && mediaPath !== PLACEHOLDER_IMG) {
      let finalVideoPath = mediaPath;

      if (mediaPath.startsWith('http')) {
        const tempPath = path.join(ACTIVE_MEDIA_DIR, `temp_${Date.now()}.mp4`);
        const response = await fetch(mediaPath);
        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
        finalVideoPath = tempPath;
      }

      const duration = await getVideoDuration(finalVideoPath);
      if (duration > 60) {
        const trimmedPath = path.join(ACTIVE_MEDIA_DIR, `trimmed_${Date.now()}.mp4`);
        finalVideoPath = await trimVideo(finalVideoPath, trimmedPath, 60);
      }

      const thumbPath = path.join(ACTIVE_MEDIA_DIR, `thumb_${Date.now()}.jpg`);
      await extractVideoThumbnail(finalVideoPath, thumbPath);

      await ig.publish.video({
        video: fs.readFileSync(finalVideoPath),
        coverImage: fs.readFileSync(thumbPath),
        caption: caption,
      });

      console.log("✅ Video posted successfully");

      if (finalVideoPath !== mediaPath) fs.unlinkSync(finalVideoPath);
      fs.unlinkSync(thumbPath);
    } else {
      await ig.publish.photo({
        file: fs.readFileSync(mediaPath),
        caption: caption,
      });
      console.log("✅ Photo posted successfully");
    }

    return true;
  } catch (err) {
    console.error("❌ Failed to publish media:", err.message);
    return false;
  }
}

// ------------------------------ Main posting loop ----------------------------
async function postLoop() {
  await ultraSafeLogin();
  loadSeen();
  loadLocalMediaUsage();
  clearSeenPostsIfNeeded();

  console.log("🚀 Making immediate startup post...");
  await makeSinglePost();

  const postCount = POSTS_PER_DAY();
  console.log(`📅 Generating ${postCount} posts for today...`);

  for (let i = 0; i < postCount; i++) {
    console.log(`\n🚀 Preparing post ${i + 1} of ${postCount}`);
    await makeSinglePost();

    if (i < postCount - 1) {
      const delay = Math.random() * 10800000 + 3600000; // 1-4 hours
      console.log(`⏰ Next post in ${Math.round(delay / 3600000)} hours`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  saveLocalMediaUsage();
}

// ------------------------------ Express keep-alive --------------------------
const app = express();

app.get("/", (req, res) => {
  res.send("🎉 Carnival Companion Bot is alive!");
});

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

// ------------------------------ Start bot -----------------------------------
(async () => {
  try {
    console.log("🚀 Starting ultra-safe bot (3-5 posts/day)...");
    console.log(`📹 MODE: ${PRIORITIZE_LOCAL_MEDIA ? 'LOCAL MEDIA PRIORITY' : 'API CONTENT PRIORITY'}`);
    console.log(`🔄 Local files will be deleted after ${LOCAL_MEDIA_USAGE_LIMIT} posts`);
    console.log(`📁 Using media directory: ${ACTIVE_MEDIA_DIR}`);

    await postLoop();
    console.log("🏁 Posting loop completed for today");
  } catch (e) {
    console.error("❌ Fatal error in bot loop:", e);
  }
})();
