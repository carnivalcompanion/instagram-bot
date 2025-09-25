const express = require('express');
const keepAliveApp = express();
const keepAlivePort = process.env.PORT || 3000;

keepAliveApp.get('/', (req, res) => {
  res.send('Node.js Bot with Google Drive integration is alive!');
});

keepAliveApp.listen(keepAlivePort, () => {
  console.log(`Keep-alive server running on port ${keepAlivePort}`);
});

require("dotenv").config();

const { IgApiClient } = require("instagram-private-api");
const { google } = require('googleapis');
const axios = require("axios");
const schedule = require("node-schedule");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Enhanced logging function
function log(emoji, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${emoji} ${message}`);
  if (data) console.log(`${timestamp} 📊 Data:`, JSON.stringify(data, null, 2));
}

// Initial logging
log("🚀", "Script starting with enhanced Google Drive integration...");

// -------------------- Enhanced Google Drive Authentication --------------------
async function authenticateGoogleDrive() {
    try {
        // Use service account authentication
        const auth = new google.auth.GoogleAuth({
            keyFile: './service-account-key.json',
            scopes: ['https://www.googleapis.com/auth/drive.readonly']
        });
        
        const drive = google.drive({ version: 'v3', auth });
        log('✅', 'Google Drive authenticated with service account');
        return drive;
    } catch (error) {
        log('❌', 'Google Drive authentication failed:', error.message);
        return null;
    }
}

// Function to get videos from Google Drive
async function getVideosFromDrive(drive, folderId = '1YLEwDRNzL3UmD9X35sEu4QSPrA50SXWS') {
    try {
        log('🔍', 'Searching Google Drive for videos...');
        
        const response = await drive.files.list({
            q: `'${folderId}' in parents and (mimeType contains 'video/' or mimeType='application/octet-stream') and trashed=false`,
            fields: 'files(id, name, mimeType, webContentLink)',
            orderBy: 'createdTime desc'
        });

        const videos = response.data.files;
        log('✅', `Found ${videos.length} videos in Google Drive`);
        
        return videos;
    } catch (error) {
        log('❌', 'Google Drive API error:', error.message);
        return [];
    }
}

async function getRandomVideo() {
    log('1️⃣', 'Attempting Google Drive source...');
    
    // Authenticate with service account
    const drive = await authenticateGoogleDrive();
    
    if (drive) {
        const driveVideos = await getVideosFromDrive(drive);
        if (driveVideos.length > 0) {
            const randomVideo = driveVideos[Math.floor(Math.random() * driveVideos.length)];
            log('✅', `Selected video from Drive: ${randomVideo.name}`);
            return { source: 'drive', video: randomVideo };
        }
    }
    
    log('📭', 'No videos found in Google Drive, falling back to Instagram...');
    return null;
}

// -------------------- Config --------------------
const accounts = [
  "aircommittee3", "illusionsmas", "reignmasband", "shineymas", "Livcarnival",
  "fantasykarnival", "chocolatenationmas", "tropicalfusionmas", "carnivalsaintlucia",
  "jabjabofficial", "fuzionmas", "scorchmag", "yardmascarnival",
];
const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

// Placeholder image path
const placeholderPath = path.join(__dirname, "placeholder.jpg");

// Safety check
if (!username || !password) {
  log("❌", "Missing Instagram credentials. Set IG_USERNAME, IG_PASSWORD.");
  process.exit(1);
}

// Instagram client
const ig = new IgApiClient();

// Captions + hashtags
const year = new Date().getFullYear();
const hashtagPool = [
  `#carnival`, `#soca`, `#caribbean`, `#trinidadcarnival`, `#carnaval`, `#fete`,
  `#socamusic`, `#carnivalcostume`, `#mas`, `#jouvert`, `#caribbeancarnival`,
  `#cropover`, `#playmas`, `#jabjab`, `#socavibes`, `#carnivalculture`,
  `#carnival${year}`, `#soca${year}`,
];

function getRandomHashtags(n = 5) {
  const shuffled = [...hashtagPool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n).join(" ");
}

const captionTemplates = [
  `Having fun at the carnival! 🎉`, `Another great day for soca and music! 🥳`,
  `Making memories that last forever! 🍹`, `Colors, feathers, and pure freedom! 🪶✨`,
  `This is how we do carnival in the islands 🌴🔥`, `Soca therapy in full effect! 🎶💃`,
  `Energy too high to calm down 🚀`, `Every beat of the drum tells a story 🥁❤️`,
  `Mas is not just a festival, it's a lifestyle 🌟`, `From sunrise to sunset, pure carnival spirit 🌞🌙`,
  `When the riddim hits, there's no standing still 🎵⚡`, `One love, one people, one carnival 💛💚❤️`,
  `The road is ours today 🛣️👑`, `Jump, wave, repeat! 🔁🙌`, `Masqueraders bringing the heat 🔥💃`,
  `The Caribbean heartbeat never stops 💓🌊`, `Carnival in full effect! 🎭🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩🇻🇨`,
];

function buildCaption(originalUser = null) {
  const randomText = captionTemplates[Math.floor(Math.random() * captionTemplates.length)];
  const hashtags = getRandomHashtags();
  const allTags = `${hashtags} #CarnivalCompanion`.split(" ").filter((tag, index, self) => tag && self.indexOf(tag) === index).join(" ");
  const credit = originalUser ? `\n\n📸 @${originalUser}` : "";
  return `${randomText}\n\n${allTags}${credit}`;
}

// -------------------- Enhanced Persistence --------------------
const sessionFile = "igSession.json";
const historyFile = "postedHistory.json";
const googleDriveHistoryFile = "googleDriveHistory.json";

let postedHistory = [];
let googleDriveHistory = {};

// Load history files
if (fs.existsSync(historyFile)) {
  try {
    postedHistory = JSON.parse(fs.readFileSync(historyFile, "utf8"));
    log("📁", `Loaded ${postedHistory.length} items from post history`);
  } catch (error) {
    log("❌", "Error loading post history:", error.message);
    postedHistory = [];
  }
}

if (fs.existsSync(googleDriveHistoryFile)) {
  try {
    googleDriveHistory = JSON.parse(fs.readFileSync(googleDriveHistoryFile, "utf8"));
    log("📁", `Loaded Google Drive history with ${Object.keys(googleDriveHistory).length} files`);
  } catch (error) {
    log("❌", "Error loading Google Drive history:", error.message);
    googleDriveHistory = {};
  }
}

// Save Google Drive history
function saveGoogleDriveHistory() {
  try {
    fs.writeFileSync(googleDriveHistoryFile, JSON.stringify(googleDriveHistory, null, 2));
    log("💾", "Google Drive history saved");
  } catch (error) {
    log("❌", "Error saving Google Drive history:", error.message);
  }
}

// -------------------- Enhanced Google Drive Media Management --------------------
async function getRandomGoogleDriveVideo() {
  try {
    log("🔍", "Getting random video from Google Drive...");
    const drive = await authenticateGoogleDrive();
    
    if (!drive) {
      log("⚠️", "Google Drive not available");
      return null;
    }

    const driveVideos = await getVideosFromDrive(drive);
    
    if (driveVideos.length === 0) {
      log("📭", "No videos found in Google Drive");
      return null;
    }

    // Filter out videos that have been posted twice
    const availableVideos = driveVideos.filter(video => {
      const postCount = googleDriveHistory[video.id]?.postCount || 0;
      return postCount < 2;
    });

    if (availableVideos.length === 0) {
      log("📊", "All Google Drive videos have been posted twice");
      return null;
    }

    // Choose random video
    const randomVideo = availableVideos[Math.floor(Math.random() * availableVideos.length)];
    const postCount = googleDriveHistory[randomVideo.id]?.postCount || 0;
    
    log("🎲", `Selected random video: ${randomVideo.name} (Posted ${postCount} times before)`);
    return randomVideo;
  } catch (error) {
    log("❌", "Error getting random Google Drive video:", error.message);
    return null;
  }
}

async function downloadFromGoogleDrive(fileId, fileName) {
  try {
    const drive = await authenticateGoogleDrive();
    if (!drive) {
      throw new Error('Google Drive not available');
    }

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const filePath = path.join(tempDir, `drive_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`);
    
    log("📥", `Downloading from Google Drive: ${fileName}`);
    
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        log("✅", `Download completed: ${fileName}`);
        resolve(filePath);
      });
      writer.on('error', (error) => {
        log("❌", `Download failed: ${fileName}`, error.message);
        reject(error);
      });
    });
  } catch (error) {
    log("❌", "Google Drive download error:", error.message);
    return null;
  }
}

async function deleteFromGoogleDrive(fileId, fileName) {
  try {
    const drive = await authenticateGoogleDrive();
    if (!drive) {
      log("⚠️", "Google Drive not configured, cannot delete file");
      return false;
    }

    log("🗑️", `Attempting to delete from Google Drive: ${fileName} (ID: ${fileId})`);
    await drive.files.delete({ fileId });
    log("✅", `Successfully deleted from Google Drive: ${fileName}`);
    return true;
  } catch (error) {
    log("❌", `Failed to delete from Google Drive: ${fileName}`, error.message);
    return false;
  }
}

function updateGoogleDriveHistory(fileId, fileName) {
  if (!googleDriveHistory[fileId]) {
    googleDriveHistory[fileId] = {
      postCount: 0,
      firstPosted: null,
      lastPosted: null,
      fileName: fileName
    };
  }

  googleDriveHistory[fileId].postCount++;
  googleDriveHistory[fileId].lastPosted = new Date().toISOString();
  
  if (!googleDriveHistory[fileId].firstPosted) {
    googleDriveHistory[fileId].firstPosted = new Date().toISOString();
  }

  log("📊", `Updated Google Drive history for ${fileName}: ${googleDriveHistory[fileId].postCount}/2 posts`);
  saveGoogleDriveHistory();

  // Check if this was the second post and delete the file
  if (googleDriveHistory[fileId].postCount >= 2) {
    log("🚨", `Video ${fileName} has been posted twice, scheduling deletion...`);
    setTimeout(async () => {
      await deleteFromGoogleDrive(fileId, fileName);
      // Remove from history after deletion
      delete googleDriveHistory[fileId];
      saveGoogleDriveHistory();
    }, 5000); // 5 second delay before deletion
  }
}

// -------------------- Helper Functions --------------------
function sleep(ms) {
  log("⏳", `Sleeping for ${ms/1000} seconds...`);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

function extractVideoFrame(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ["00:00:01"],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '720x1280'
      })
      .on('end', () => {
        log("✅", "Frame extracted successfully");
        resolve(outputPath);
      })
      .on('error', (err) => {
        log("❌", "Error extracting frame:", err);
        reject(err);
      });
  });
}

function shouldUseLogo() {
  const useLogo = Math.random() < 0.1;
  log("🎲", `Using logo for cover: ${useLogo}`);
  return useLogo;
}

// -------------------- Instagram Authentication --------------------
async function login() {
  log("🔑", "Starting Instagram login...");
  ig.state.generateDevice(username);

  if (fs.existsSync(sessionFile)) {
    try {
      await ig.state.deserialize(JSON.parse(fs.readFileSync(sessionFile)));
      log("✅", "Reused saved Instagram session");
      return;
    } catch (error) {
      log("⚠️", "Failed to load saved session, logging in fresh...", error.message);
    }
  }

  try {
    log("🔑", "Logging in fresh...");
    await ig.account.login(username, password);
    const serialized = await ig.state.serialize();
    delete serialized.constants;
    fs.writeFileSync(sessionFile, JSON.stringify(serialized, null, 2));
    log("✅", "New session saved successfully");
  } catch (error) {
    log("❌", "Instagram login failed:", error.message);
    throw error;
  }
}

async function refreshSession() {
  try {
    log("🔄", "Refreshing Instagram session...");
    await ig.state.reset();
    await login();
    log("✅", "Instagram session refreshed");
  } catch (err) {
    log("❌", "Failed to refresh session:", err.message);
  }
}

// -------------------- Media Fetch Helper --------------------
async function fetchMediaFromAccount(account, preferredType = null) {
  if (!rapidApiKey) {
    log("⚠️", "RapidAPI key not configured, skipping API fetch");
    return null;
  }

  try {
    log("🔍", `Fetching media from Instagram account: @${account}`);
    const normalizedName = account.toLowerCase().replace(/^\@/, "");
    
    const response = await axios.get(
      `https://instagram-social-api.p.rapidapi.com/v1/posts?username_or_id_or_url=${normalizedName}`,
      {
        headers: {
          "x-rapidapi-key": rapidApiKey,
          "x-rapidapi-host": "instagram-social-api.p.rapidapi.com",
        },
        timeout: 20000,
      }
    );

    let items = [];
    if (Array.isArray(response.data?.data?.items)) {
      items = response.data.data.items;
    } else if (Array.isArray(response.data?.items)) {
      items = response.data.items;
    } else if (Array.isArray(response.data)) {
      items = response.data;
    }

    if (!items.length) {
      log("⚠️", `No posts found for @${account}`);
      return null;
    }

    let post = items.find(p => preferredType ? p.media_type === preferredType : true);
    if (!post) post = items[0];

    let mediaUrl = null;
    if (post.media_type === 2) {
      mediaUrl = post.video_versions?.[0]?.url ||
                 post.videos?.[0]?.url ||
                 post.carousel_media?.[0]?.video_versions?.[0]?.url;
    } else if (post.media_type === 1 || post.media_type === 8) {
      mediaUrl = post.image_versions2?.candidates?.[0]?.url ||
                 post.images?.standard_resolution?.url ||
                 post.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url;
    }

    if (!mediaUrl) {
      log("⚠️", `Could not find media URL for @${account}`);
      return null;
    }

    log("✅", `Found media from @${account}: ${post.media_type === 2 ? 'video' : 'image'}`);
    return { post, mediaUrl };
  } catch (err) {
    log("❌", `Error fetching posts for @${account}:`, err.message);
    return null;
  }
}

// -------------------- Main Posting Logic --------------------
async function postMediaFromSource(sourceType, mediaData, caption) {
  let tempVideoPath = null;
  let tempFramePath = null;

  try {
    log("📤", `Posting media from ${sourceType}...`);
    await refreshSession();

    // Check if it's a video and validate duration
    if (mediaData.mediaType === 'video' || mediaData.filePath.endsWith('.mp4')) {
      log("🎬", "Processing video file...");
      
      try {
        const duration = await getVideoDuration(mediaData.filePath);
        log("⏱️", `Video duration: ${duration} seconds`);
        
        if (duration < 3 || duration > 60) {
          log("⚠️", `Skipping invalid video (duration: ${duration}s)`);
          return false;
        }
      } catch (err) {
        log("❌", "Error checking video duration:", err.message);
        return false;
      }

      // Extract frame or use logo
      let coverPath = placeholderPath;
      if (!shouldUseLogo()) {
        try {
          tempFramePath = path.join(__dirname, "temp_frame.jpg");
          await extractVideoFrame(mediaData.filePath, tempFramePath);
          coverPath = tempFramePath;
          log("✅", "Using video frame as cover image");
        } catch (err) {
          log("⚠️", "Failed to extract frame, using logo");
        }
      } else {
        log("🎲", "Using logo as cover image");
      }

      await ig.publish.video({
        video: fs.readFileSync(mediaData.filePath),
        coverImage: fs.readFileSync(coverPath),
        caption: caption,
      });
    } else {
      log("🖼️", "Processing image file...");
      await ig.publish.photo({
        file: fs.readFileSync(mediaData.filePath),
        caption: caption,
      });
    }

    // Save to post history
    const historyItem = { 
      id: mediaData.id || path.basename(mediaData.filePath),
      timestamp: Date.now(),
      username: mediaData.username || sourceType,
      media_type: mediaData.mediaType === 'video' ? 2 : 1,
      success: true,
      source: sourceType
    };

    postedHistory.push(historyItem);
    if (postedHistory.length > 1000) {
      postedHistory = postedHistory.slice(-1000);
    }
    fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));

    // Update Google Drive history if applicable
    if (sourceType === 'google-drive' && mediaData.id) {
      updateGoogleDriveHistory(mediaData.id, mediaData.fileName);
    }

    log("✅", `Successfully posted from ${sourceType}!`);
    return true;
  } catch (err) {
    log("❌", `Error posting from ${sourceType}:`, err.message);
    return false;
  } finally {
    // Clean up temporary files
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      fs.unlinkSync(tempVideoPath);
      log("🧹", "Cleaned up temporary video file");
    }
    if (tempFramePath && fs.existsSync(tempFramePath)) {
      fs.unlinkSync(tempFramePath);
      log("🧹", "Cleaned up temporary frame file");
    }
    // Clean up downloaded Google Drive files
    if (sourceType === 'google-drive' && mediaData.filePath && fs.existsSync(mediaData.filePath)) {
      fs.unlinkSync(mediaData.filePath);
      log("🧹", "Cleaned up downloaded Google Drive file");
    }
  }
}

async function postPlaceholder() {
  if (!fs.existsSync(placeholderPath)) {
    log("❌", "Placeholder image missing!");
    return;
  }

  try {
    log("🖼️", "Posting placeholder image...");
    await refreshSession();
    await ig.publish.photo({
      file: fs.readFileSync(placeholderPath),
      caption: buildCaption(),
    });
    log("✅", "Placeholder image posted successfully");
  } catch (err) {
    log("❌", "Failed to post placeholder:", err.message);
  }
}

// -------------------- Priority-Based Posting --------------------
async function makePost() {
  log("🔄", "Starting priority-based posting sequence...");

  // 1️⃣ Try Google Drive first
  log("1️⃣", "Attempting Google Drive source...");
  const driveVideo = await getRandomGoogleDriveVideo();
  if (driveVideo) {
    log("📥", `Downloading Google Drive video: ${driveVideo.name}`);
    const downloadedPath = await downloadFromGoogleDrive(driveVideo.id, driveVideo.name);
    
    if (downloadedPath) {
      const success = await postMediaFromSource('google-drive', {
        filePath: downloadedPath,
        mediaType: 'video',
        id: driveVideo.id,
        fileName: driveVideo.name,
        username: 'google-drive'
      }, buildCaption());
      
      if (success) {
        log("✅", "Google Drive post completed successfully");
        return;
      }
    }
  }

  // 2️⃣ Try Instagram API
  log("2️⃣", "Attempting Instagram API source...");
  if (rapidApiKey) {
    let allPosts = [];
    for (let acc of accounts) {
      log("🔍", `Fetching from Instagram account: @${acc}`);
      const fetched = await fetchMediaFromAccount(acc, 2); // Prefer video
      if (fetched) {
        allPosts.push({...fetched, account: acc});
      }
      await sleep(5000); // Rate limiting
    }

    if (allPosts.length > 0) {
      const randomPost = allPosts[Math.floor(Math.random() * allPosts.length)];
      log("📤", `Trying API content from @${randomPost.account}`);
      
      try {
        const response = await axios.get(randomPost.mediaUrl, { 
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {'User-Agent': 'Mozilla/5.0'}
        });
        
        const tempPath = path.join(__dirname, "temp_api_video.mp4");
        fs.writeFileSync(tempPath, response.data);
        
        const success = await postMediaFromSource('api', {
          filePath: tempPath,
          mediaType: 'video',
          id: randomPost.post.id,
          username: randomPost.account
        }, buildCaption(randomPost.account));
        
        if (success) {
          log("✅", "Instagram API post completed successfully");
          return;
        }
      } catch (err) {
        log("❌", "API post failed:", err.message);
      }
    } else {
      log("⚠️", "No API content available");
    }
  } else {
    log("⚠️", "RapidAPI key not configured, skipping API source");
  }

  // 3️⃣ Fallback to placeholder
  log("3️⃣", "Falling back to placeholder...");
  await postPlaceholder();
  log("✅", "Placeholder post completed");
}

// -------------------- Scheduling --------------------
const PEAK_HOURS = [
  { start: 9, end: 11 },   // Morning peak
  { start: 13, end: 15 },  // Afternoon peak
  { start: 19, end: 21 }   // Evening peak
];

const POSTS_PER_DAY = 3; // 2-4 posts as requested

function getRandomPostTime() {
  const peakSlot = PEAK_HOURS[Math.floor(Math.random() * PEAK_HOURS.length)];
  const hour = peakSlot.start + Math.floor(Math.random() * (peakSlot.end - peakSlot.start));
  const minute = Math.floor(Math.random() * 60);
  
  const now = new Date();
  const scheduledDate = new Date(now);
  scheduledDate.setHours(hour, minute, 0, 0);
  
  if (scheduledDate < now) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  }
  
  log("⏰", `Generated random post time: ${scheduledDate.toLocaleString()}`);
  return scheduledDate;
}

function schedulePosts() {
  log("📅", `Scheduling ${POSTS_PER_DAY} posts per day`);
  
  // Immediate post on startup
  log("⚡", "Scheduling immediate startup post...");
  schedule.scheduleJob(new Date(Date.now() + 10000), async () => {
    log("🎬", "Executing immediate startup post...");
    await makePost();
  });

  // Schedule daily posts
  for (let i = 0; i < POSTS_PER_DAY; i++) {
    const postTime = getRandomPostTime();
    schedule.scheduleJob(postTime, async () => {
      log("🕒", `Executing scheduled post ${i+1} at ${postTime.toLocaleString()}`);
      await makePost();
      
      // Random delay between posts (30-180 seconds)
      const delay = Math.floor(Math.random() * 150000) + 30000;
      log("⏳", `Next post delay: ${Math.floor(delay / 1000)} seconds`);
      await sleep(delay);
    });
    
    log("✅", `Scheduled post ${i+1} for ${postTime.toLocaleString()}`);
  }
}

// -------------------- Main Execution --------------------
(async () => {
  log("🌐", "Starting Instagram Bot with enhanced Google Drive integration");
  
  try {
    await login();
    
    if (process.argv.includes("--test")) {
      log("🔍", "Running in test mode...");
      await makePost();
      log("✅", "Test completed successfully");
    } else {
      log("🚀", "Starting scheduled mode...");
      schedulePosts();
    }
  } catch (error) {
    log("❌", "Startup error:", error.message);
    process.exit(1);
  }
})();