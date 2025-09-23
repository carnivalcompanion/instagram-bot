// -----------------------------------------------------------------------------
// Instagram Bot — Ultra-Safe Anti-Detection Mode (2-4 posts/day)
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

// ----------------------------- Path helpers ----------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------------- .env / config ---------------------------------
dotenv.config();

const USERNAME = process.env.IG_USERNAME;
const PASSWORD = process.env.IG_PASSWORD;

// Optional, comma-separated list. Falls back to defaults if not provided.
const API_ACCOUNTS =
  (process.env.API_ACCOUNTS || "aircommittee3,fuzionmas,scorchmag,yardmascarnival")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// Where to read local media from (MP4/MOV/AVI/MKV - videos only)
const MEDIA_DIR = path.resolve(process.env.LOCAL_MEDIA_DIR || path.join(__dirname, "localMedia"));
// Placeholder if API + local fail (should be an image)
const PLACEHOLDER_IMG = path.resolve(process.env.PLACEHOLDER_IMG || path.join(__dirname, "placeholder.jpg"));
// Session state (persist login)
const SESSION_FILE = path.resolve(process.env.SESSION_FILE || path.join(__dirname, "session.json"));
// Seen post IDs store (so we don't re-use API posts too soon)
const SEEN_FILE = path.resolve(process.env.SEEN_FILE || path.join(__dirname, "seen.json"));

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

// Ultra-safe posting frequency (2-4 posts per day)
const POSTS_PER_DAY = () => Math.floor(Math.random() * 3) + 2; // 2-4 random posts

// Extended delays for anti-detection
const MIN_DELAY_BETWEEN_ACTIONS = 60000; // 1 minute minimum
const MAX_DELAY_BETWEEN_ACTIONS = 300000; // 5 minutes maximum

// Keep-alive HTTP port (Render provides PORT)
const PORT = Number(process.env.PORT || 3000);

// ----------------------------- Configuration ---------------------------------
const PRIORITIZE_LOCAL_MEDIA = true; // Set to false to use API content again
const LOCAL_MEDIA_USAGE_LIMIT = 2; // Delete local files after this many posts

// ------------------------------- Guards --------------------------------------
if (!USERNAME || !PASSWORD) {
  console.error("❌ Missing environment variables. Set IG_USERNAME, IG_PASSWORD.");
  process.exit(1);
}

// Safe directory check for Render (DO NOT try to create directories)
let ACTIVE_MEDIA_DIR = MEDIA_DIR;
try {
  // Just check if we can access the directory, don't create it
  if (!fs.existsSync(MEDIA_DIR)) {
    console.warn(`⚠️ Media directory does not exist: ${MEDIA_DIR}`);
    console.log("📁 Using current directory for media storage");
    ACTIVE_MEDIA_DIR = __dirname; // Fallback to current directory
  } else {
    console.log("✅ Media directory accessible:", MEDIA_DIR);
  }
} catch (error) {
  console.warn("⚠️ Could not access media directory, using current directory");
  ACTIVE_MEDIA_DIR = __dirname;
}

// ------------------------------ Globals --------------------------------------
const ig = new IgApiClient();

let seenState = {
  lastCleared: Date.now(),
  ids: [],
};
let seenSet = new Set();

// ------------------------------ Utilities ------------------------------------
function loadJSON(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
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

// Clear every 2 days
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

// Friendly time format
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

// Get random hashtags from the carnival list
function getRandomHashtags(count = 8) {
  const shuffled = [...CARNIVAL_HASHTAGS].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count).join(' ');
}

// Generate caption with credit and hashtags
function generateCaption(baseCaption, sourceUsername, isApiContent = false) {
  let caption = baseCaption;
  
  // Add credit for API content
  if (isApiContent && sourceUsername) {
    caption += `\n\n🎥 Credit: @${sourceUsername}`;
    caption += `\n📌 Follow for daily carnival content!`;
  } else {
    caption += `\n\n📌 Follow @${USERNAME} for daily carnival content!`;
  }
  
  // Add mandatory CarnivalCompanion hashtag and random carnival hashtags
  caption += `\n\n#CarnivalCompanion ${getRandomHashtags(8)}`;
  
  return caption;
}

// Enhanced caption variation to avoid pattern detection
function varyCaptionAdvanced(baseCaption, sourceUsername) {
  const emotionVariations = [
    { prefix: "Loving the energy in this! ", emoji: "🔥" },
    { prefix: "The vibes are incredible! ", emoji: "💃" },
    { prefix: "This made my day! ", emoji: "✨" },
    { prefix: "Can't get enough of this! ", emoji: "🎭" },
    { prefix: "The culture is beautiful! ", emoji: "🌟" },
    { prefix: "", emoji: "📸" }, // No prefix sometimes
    { prefix: "Wow! ", emoji: "🎉" },
    { prefix: "Incredible moment! ", emoji: "🙌" }
  ];
  
  const variation = emotionVariations[Math.floor(Math.random() * emotionVariations.length)];
  
  let newCaption = baseCaption;
  
  // 60% chance to add emotional prefix
  if (Math.random() < 0.6) {
    newCaption = variation.prefix + newCaption;
  }
  
  // Always use random emoji
  newCaption = variation.emoji + " " + newCaption;
  
  // Occasionally add location context (30% chance)
  if (Math.random() < 0.3) {
    const locations = ["Trinidad", "Caribbean", "West Indies", "Island Life"];
    const location = locations[Math.floor(Math.random() * locations.length)];
    newCaption += ` ${location} vibes!`;
  }
  
  return generateCaption(newCaption, sourceUsername, sourceUsername !== null);
}

// Random delay function for anti-detection
async function randomDelay(minMs = MIN_DELAY_BETWEEN_ACTIONS, maxMs = MAX_DELAY_BETWEEN_ACTIONS) {
  const delayMs = Math.random() * (maxMs - minMs) + minMs;
  console.log(`⏳ Delaying for ${Math.round(delayMs/1000)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

// Extract thumbnail from video using ffmpeg
function extractVideoThumbnail(videoPath, thumbnailPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01'], // Capture at 1 second
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

// Get video duration
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

// Trim video to maximum duration
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

// ------------------------------ Instagram login ------------------------------
async function saveSession() {
  const serialized = await ig.state.serialize();
  delete serialized.constants; // remove circular refs
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
  
  // Extended random delay before login (3-8 minutes)
  const initialDelay = Math.random() * 300000 + 180000;
  console.log(`⏳ Delaying login for ${Math.round(initialDelay/1000)} seconds...`);
  await new Promise(resolve => setTimeout(resolve, initialDelay));
  
  ig.state.generateDevice(USERNAME);
  
  if (await loadSession()) {
    try {
      // Verify session with timeout
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

  // Additional delay before fresh login
  await randomDelay(60000, 120000);
  
  console.log("🔑 Performing fresh login...");
  await ig.account.login(USERNAME, PASSWORD);
  await saveSession();
  
  // Extended delay after login (2-5 minutes)
  await randomDelay(120000, 300000);
  
  console.log("🔓 Login sequence completed safely");
}

// ------------------------------ Direct Instagram API fetch -------------------
async function fetchUserVideosDirectly(username) {
  try {
    console.log(`🔍 Fetching videos directly from @${username}...`);
    
    // Get user ID from username
    const userId = await ig.user.getIdByUsername(username);
    const userFeed = ig.feed.user(userId);
    
    let items = [];
    let hasMore = true;
    let attempt = 0;
    
    // Get up to 20 posts (multiple pages if needed)
    while (hasMore && items.length < 20 && attempt < 3) {
      attempt++;
      try {
        const page = await userFeed.items();
        items.push(...page);
        
        if (page.length === 0) {
          hasMore = false;
        }
        
        // Anti-detection delay between page requests
        await randomDelay(2000, 5000);
      } catch (error) {
        console.error(`❌ Error fetching page ${attempt} for @${username}:`, error.message);
        hasMore = false;
      }
    }
    
    console.log(`📊 Found ${items.length} posts from @${username}`);
    
    // Filter for videos only
    const videoItems = items.filter(item => {
      const isVideo = item?.video_codec && item?.video_versions?.length > 0;
      const notSeen = !seenSet.has(item.id);
      return isVideo && notSeen;
    });
    
    console.log(`📹 ${username}: ${videoItems.length} new video(s)`);
    
    return videoItems.map(item => ({
      id: item.id,
      url: item.video_versions[0]?.url, // Get highest quality video
      is_video: true,
      caption: item.caption?.text || '',
      username: username // Store the source username for credit
    }));
    
  } catch (error) {
    console.error(`❌ Failed to fetch videos from @${username}:`, error.message);
    return [];
  }
}

// ------------------------------ Video Usage Tracking -------------------------
function getVideoUsageFile() {
  return path.join(__dirname, 'video_usage.json');
}

function loadVideoUsage() {
  try {
    if (fs.existsSync(getVideoUsageFile())) {
      return JSON.parse(fs.readFileSync(getVideoUsageFile(), 'utf8'));
    }
  } catch (e) {
    console.warn('⚠️ Failed to load video usage tracking:', e.message);
  }
  return {};
}

function saveVideoUsage(usage) {
  try {
    fs.writeFileSync(getVideoUsageFile(), JSON.stringify(usage, null, 2));
  } catch (e) {
    console.warn('⚠️ Failed to save video usage:', e.message);
  }
}

function markVideoAsUsed(filename) {
  const usage = loadVideoUsage();
  usage[filename] = (usage[filename] || 0) + 1;
  saveVideoUsage(usage);
  console.log(`📊 Updated usage for ${filename}: ${usage[filename]} time(s)`);
  
  // Delete if posted enough times (only if we have write access)
  if (usage[filename] >= LOCAL_MEDIA_USAGE_LIMIT) {
    deleteVideoFile(filename);
  }
}

function deleteVideoFile(filename) {
  const filePath = path.join(ACTIVE_MEDIA_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted ${filename} (posted ${LOCAL_MEDIA_USAGE_LIMIT} times)`);
      
      // Clean up usage record
      const usage = loadVideoUsage();
      delete usage[filename];
      saveVideoUsage(usage);
    }
  } catch (e) {
    console.warn(`⚠️ Could not delete ${filename} (read-only filesystem?):`, e.message);
  }
}

// ------------------------------ Media helpers --------------------------------
async function downloadApiMedia(url, filepath) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bad response ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    if (!buf || buf.length < 2048) {
      throw new Error(`Downloaded file too small (${buf?.length || 0} bytes) from ${url}`);
    }

    await fs.promises.writeFile(filepath, buf);
    return filepath;
  } catch (err) {
    console.error("❌ Failed to download API media:", err.message);
    return null;
  }
}

function findLocalVideos() {
  if (!fs.existsSync(ACTIVE_MEDIA_DIR)) {
    console.log("Media directory does not exist:", ACTIVE_MEDIA_DIR);
    return [];
  }
  
  const files = fs.readdirSync(ACTIVE_MEDIA_DIR);
  const videoFiles = files.filter((f) => isVideoFile(f));
  const usage = loadVideoUsage();
  
  console.log(`Found ${videoFiles.length} local video files`);
  
  const availableVideos = videoFiles.map((f) => {
    const filePath = path.join(ACTIVE_MEDIA_DIR, f);
    const usageCount = usage[f] || 0;
    
    return {
      path: filePath,
      filename: f,
      is_video: true,
      usageCount: usageCount,
      canBeUsed: usageCount < LOCAL_MEDIA_USAGE_LIMIT
    };
  }).filter(video => video.canBeUsed);
  
  console.log(`📹 ${availableVideos.length} videos available (not posted ${LOCAL_MEDIA_USAGE_LIMIT} times yet)`);
  
  // Log usage statistics
  videoFiles.forEach(f => {
    const count = usage[f] || 0;
    const status = count >= LOCAL_MEDIA_USAGE_LIMIT ? "✓ DONE" : `${LOCAL_MEDIA_USAGE_LIMIT - count} left`;
    console.log(`   ${f}: posted ${count} time(s) [${status}]`);
  });
  
  return availableVideos;
}

// Process video for Instagram (trim if needed)
async function processVideoForInstagram(videoPath) {
  try {
    const duration = await getVideoDuration(videoPath);
    console.log(`📏 Video duration: ${duration.toFixed(2)} seconds`);
    
    // Instagram feed videos must be between 3-60 seconds
    if (duration > 60) {
      console.log(`✂️ Trimming video to 60 seconds for Instagram feed...`);
      const trimmedPath = path.join(__dirname, `temp_trimmed_${Date.now()}.mp4`);
      await trimVideo(videoPath, trimmedPath, 60);
      return { path: trimmedPath, isTrimmed: true, originalDuration: duration };
    }
    
    return { path: videoPath, isTrimmed: false, originalDuration: duration };
  } catch (error) {
    console.error("❌ Failed to process video:", error.message);
    return { path: videoPath, isTrimmed: false, originalDuration: null };
  }
}

// ------------------------------ Posting --------------------------------------
async function publishPhoto(filePath, caption) {
  const fileBuf = await fs.promises.readFile(filePath);
  const res = await ig.publish.photo({ file: fileBuf, caption });
  try {
    const code = res?.media?.code;
    if (code) console.log(`✅ Photo posted: https://instagram.com/p/${code}`);
    else console.log("✅ Photo posted");
  } catch {
    console.log("✅ Photo posted");
  }
}

async function publishVideo(videoPath, caption) {
  // Process video first (trim if needed)
  const processed = await processVideoForInstagram(videoPath);
  const finalVideoPath = processed.path;
  
  const videoBuffer = await fs.promises.readFile(finalVideoPath);
  
  // Extract thumbnail from the video
  const thumbnailPath = path.join(__dirname, 'temp_thumbnail.jpg');
  
  try {
    await extractVideoThumbnail(finalVideoPath, thumbnailPath);
    const thumbnailBuffer = await fs.promises.readFile(thumbnailPath);
    
    const res = await ig.publish.video({
      video: videoBuffer,
      coverImage: thumbnailBuffer,
      caption: caption
    });
    
    try {
      const code = res?.media?.code;
      if (code) console.log(`✅ Video posted: https://instagram.com/p/${code}`);
      else console.log("✅ Video posted");
    } catch {
      console.log("✅ Video posted");
    }
  } catch (err) {
    console.error("❌ Failed to process video, falling back to placeholder thumbnail");
    
    // Fallback: use placeholder image as thumbnail
    if (fs.existsSync(PLACEHOLDER_IMG)) {
      const thumbnailBuffer = await fs.promises.readFile(PLACEHOLDER_IMG);
      const res = await ig.publish.video({
        video: videoBuffer,
        coverImage: thumbnailBuffer,
        caption: caption
      });
      console.log("✅ Video posted with placeholder thumbnail");
    } else {
      throw new Error("No thumbnail available for video");
    }
  } finally {
    // Clean up temporary files
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
    }
    if (processed.isTrimmed && fs.existsSync(finalVideoPath)) {
      fs.unlinkSync(finalVideoPath);
    }
  }
}

async function publishMedia(filePath, caption, isVideo = false) {
  if (isVideo) {
    await publishVideo(filePath, caption);
  } else {
    await publishPhoto(filePath, caption);
  }
}

// ------------------------------ Ultra-Safe Scheduling ------------------------------
function generateHumanLikeSchedule() {
  const totalPosts = POSTS_PER_DAY();
  const schedules = [];
  
  console.log(`🎯 Generating ${totalPosts} posts for today (anti-detection mode)`);
  
  // Spread posts across a 14-hour active period (8 AM - 10 PM)
  const activeStartHour = 8;
  const activeEndHour = 22;
  const activeWindowMs = (activeEndHour - activeStartHour) * 60 * 60 * 1000;
  
  // Divide the active window into segments for better distribution
  const segments = [];
  for (let i = 0; i < totalPosts; i++) {
    const segmentStart = (i / totalPosts) * activeWindowMs;
    const segmentEnd = ((i + 1) / totalPosts) * activeWindowMs;
    segments.push([segmentStart, segmentEnd]);
  }
  
  segments.forEach(([segmentStart, segmentEnd], index) => {
    // Random position within segment
    const randomOffset = Math.random() * (segmentEnd - segmentStart);
    const postTimeMs = segmentStart + randomOffset;
    
    // Convert to actual time
    const postTime = new Date();
    postTime.setHours(activeStartHour, 0, 0, 0);
    postTime.setTime(postTime.getTime() + postTimeMs);
    
    // If time has passed, schedule for tomorrow
    if (postTime <= new Date()) {
      postTime.setDate(postTime.getDate() + 1);
    }
    
    // Add final random variance (± 45 minutes)
    const variance = (Math.random() - 0.5) * 90 * 60 * 1000;
    postTime.setTime(postTime.getTime() + variance);
    
    schedules.push(postTime);
  });
  
  return schedules.sort((a, b) => a - b);
}

async function executePostSafe(item, localQueue, type) {
  try {
    console.log(`🕒 Preparing ${type} post...`);
    
    // Extended random delay (1-4 minutes)
    await randomDelay(60000, 240000);
    
    let mediaPath = null;
    let isVideo = false;
    let caption = type === "immediate" ? DEFAULT_IMMEDIATE_CAPTION : DEFAULT_SCHEDULED_CAPTION;
    let sourceUsername = null;

    if (item) {
      if (item.type === "local") {
        if (fs.existsSync(item.path)) {
          mediaPath = item.path;
          isVideo = true;
          console.log("📹 Using local video");
          
          // Track usage for local videos
          if (item.filename) {
            markVideoAsUsed(item.filename);
          }
        }
      } else if (item.type === "api") {
        // Only use API content if we're not prioritizing local media
        if (!PRIORITIZE_LOCAL_MEDIA) {
          const dest = path.join(ACTIVE_MEDIA_DIR, `api_${item.id}_${Date.now()}.mp4`);
          mediaPath = await downloadApiMedia(item.url, dest);
          isVideo = true;
          sourceUsername = item.username;
          if (item.caption) {
            caption = item.caption.length > 80 ? item.caption.substring(0, 80) + '...' : item.caption;
          }
          console.log("🌐 Using API video");
        } else {
          console.log("📹 API content skipped (local media priority mode)");
        }
      }
    }

    // If prioritizing local media, try local files first as fallback
    if (PRIORITIZE_LOCAL_MEDIA && !mediaPath && localQueue.length > 0) {
      await randomDelay(30000, 60000);
      const availableLocal = localQueue.filter(video => video.canBeUsed);
      if (availableLocal.length > 0) {
        const randomLocal = availableLocal[Math.floor(Math.random() * availableLocal.length)];
        if (fs.existsSync(randomLocal.path)) {
          mediaPath = randomLocal.path;
          isVideo = true;
          console.log("📹 Fallback to random local video");
          markVideoAsUsed(randomLocal.filename);
        }
      }
    }

    // Fallback to API content only if not prioritizing local media
    if (!PRIORITIZE_LOCAL_MEDIA && !mediaPath && localQueue.length > 0) {
      await randomDelay(30000, 60000);
      const randomLocal = localQueue[Math.floor(Math.random() * localQueue.length)];
      if (fs.existsSync(randomLocal.path)) {
        mediaPath = randomLocal.path;
        isVideo = true;
        console.log("📹 Fallback to random local video");
      }
    }

    if (!mediaPath && fs.existsSync(PLACEHOLDER_IMG)) {
      await randomDelay(30000, 60000); // 30-60s delay
      mediaPath = PLACEHOLDER_IMG;
      isVideo = false;
      console.log("🖼️ Fallback to placeholder image");
    }

    if (!mediaPath) {
      console.error("❌ No media available for post.");
      return;
    }

    // Enhanced caption variation
    caption = varyCaptionAdvanced(caption, sourceUsername);

    // Final random delay before posting (30-90 seconds)
    await randomDelay(30000, 90000);

    console.log("📤 Publishing post...");
    await publishMedia(mediaPath, caption, isVideo);
    console.log(`✅ ${type} post published at ${fmtTime(new Date())}`);
    
    // Post-publish delay (avoid rapid successive actions)
    await randomDelay(120000, 240000);
    
  } catch (err) {
    console.error(`❌ ${type} upload failed:`, err.message);
    // Extended delay on error
    await randomDelay(300000, 600000);
  }
}

async function schedulePostsUltraSafe(apiQueue, localQueue) {
  clearSeenPostsIfNeeded();
  persistSeen();

  const combined = [
    // Only include API items if we're not prioritizing local media
    ...(PRIORITIZE_LOCAL_MEDIA ? [] : apiQueue.map((i) => ({ 
      id: i.id, 
      url: i.url, 
      is_video: true, 
      type: "api", 
      caption: i.caption,
      username: i.username
    }))),
    ...localQueue.map((item) => ({ 
      path: item.path, 
      filename: item.filename,
      is_video: true, 
      type: "local" 
    })),
  ];

  const scheduleTimes = generateHumanLikeSchedule();
  const toSchedule = Math.min(scheduleTimes.length, combined.length || scheduleTimes.length);
  
  console.log(`📅 Ultra-safe schedule (${toSchedule} posts):`);
  
  for (let i = 0; i < toSchedule; i++) {
    const item = combined[i % combined.length] || null;
    const postTime = scheduleTimes[i];
    
    const delayMs = Math.max(postTime.getTime() - Date.now(), 1000);
    
    console.log(`   #${i + 1} → ${fmtTime(postTime)} - ${item ? (item.type === 'local' ? 'LOCAL' : 'API') : 'fallback'}`);

    setTimeout(async () => {
      // Extended random delay before posting (2-8 minutes)
      await randomDelay(120000, 480000);
      
      await executePostSafe(item, localQueue, "scheduled");
    }, delayMs);
  }
}

// ------------------------------ Keep-alive server -----------------------------
function startServer() {
  const app = express();
  app.get("/", (_req, res) => res.send("Ultra-Safe Bot is alive"));
  app.get("/healthz", (_req, res) => res.json({ 
    ok: true, 
    time: Date.now(),
    mode: "ultra-safe",
    posts_today: POSTS_PER_DAY()
  }));
  app.listen(PORT, () =>
    console.log(`🌐 Keep-alive server on :${PORT} (Render: ${!!process.env.RENDER})`)
  );
}

// ------------------------------ Main -----------------------------------------
async function main() {
  // Start the server IMMEDIATELY so Render can detect the port
  startServer();
  
  console.log("🚀 Starting ultra-safe bot (2-4 posts/day)...");
  console.log("Using media directory:", ACTIVE_MEDIA_DIR);
  console.log(`📹 MODE: ${PRIORITIZE_LOCAL_MEDIA ? 'LOCAL MEDIA PRIORITY' : 'API CONTENT PRIORITY'}`);
  console.log(`🔄 Local files will be deleted after ${LOCAL_MEDIA_USAGE_LIMIT} posts`);

  // 25% chance to take a day off for safety
  const takeDayOff = Math.random() < 0.25;
  if (takeDayOff) {
    console.log("🌴 Safety day off - skipping posts today (25% chance)");
    // Server is already running for health checks
    return;
  }

  loadSeen();
  await ultraSafeLogin();

  // Gather videos with extended delays (API content still fetched but may not be used)
  let apiItems = [];
  for (const u of API_ACCOUNTS) {
    console.log(`🔍 Scanning @${u}...`);
    const items = await fetchUserVideosDirectly(u);
    apiItems.push(...items);
    
    // Extended delay between account scans (3-6 minutes)
    await randomDelay(180000, 360000);
  }

  // Mark API items as seen
  apiItems.forEach(item => seenSet.add(item.id));
  persistSeen();

  const localVideos = findLocalVideos();

  console.log(
    `📦 Content pool → API: ${apiItems.length} video(s), Local: ${localVideos.length} video(s)`
  );

  // Immediate post with safety delays - prioritize local media if configured
  if (apiItems.length > 0 || localVideos.length > 0) {
    let immediateItem;
    
    if (PRIORITIZE_LOCAL_MEDIA && localVideos.length > 0) {
      // Prioritize local media
      immediateItem = { ...localVideos[0], type: "local" };
      console.log("📹 Immediate post: Using local media (priority mode)");
    } else if (apiItems.length > 0) {
      // Use API content if available and not prioritizing local
      immediateItem = { ...apiItems[0], type: "api" };
      console.log("🌐 Immediate post: Using API content");
    } else if (localVideos.length > 0) {
      // Fallback to local media
      immediateItem = { ...localVideos[0], type: "local" };
      console.log("📹 Immediate post: Fallback to local media");
    }
    
    await executePostSafe(immediateItem, localVideos, "immediate");
  } else {
    console.log("⚠️ No content available for immediate post");
  }

  // Ultra-safe scheduling
  await schedulePostsUltraSafe(apiItems, localVideos);

  console.log("✅ Bot running in ultra-safe mode (2-4 posts/day)");
  
  // Keep the process alive for scheduled posts
  // The server is already running from the startServer() call above
}
main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});