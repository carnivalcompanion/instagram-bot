const express = require('express');
const keepAliveApp = express();
const keepAlivePort = process.env.PORT || 3000;

keepAliveApp.get('/', (req, res) => {
  res.send('Node.js Bot is alive!');
});

keepAliveApp.listen(keepAlivePort, () => {
  console.log(`Keep-alive server running on port ${keepAlivePort}`);
});
require("dotenv").config();

const { IgApiClient } = require("instagram-private-api");
const axios = require("axios");
const schedule = require("node-schedule");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Initial logging
console.log("🚀 Script starting...");
console.log("Arguments:", process.argv);

// -------------------- Config --------------------
const accounts = [
  "aircommittee3",
  "illusionsmas",
  "reignmasband",
  "shineymas",
  "Livcarnival", 
  "fantasykarnival",
  "chocolatenationmas",
  "tropicalfusionmas",
  "carnivalsaintlucia",
  "jabjabofficial",
  "fuzionmas",
  "scorchmag",
  "yardmascarnival",
];
const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

// Path to your local media folder (symlinked to iCloud)
const localMediaDir = path.join(__dirname, "localMedia");
console.log("Using media directory:", localMediaDir);

// Placeholder image path
const placeholderPath = path.join(__dirname, "placeholder.jpg");

// Safety check
if (!username || !password || !rapidApiKey) {
  console.error("❌ Missing environment variables. Set IG_USERNAME, IG_PASSWORD, RAPIDAPI_KEY.");
  process.exit(1);
}

// Instagram client
const ig = new IgApiClient();

// Captions + hashtags
const year = new Date().getFullYear();
const hashtagPool = [
  `#carnival`,
  `#soca`,
  `#caribbean`,
  `#trinidadcarnival`,
  `#carnaval`,
  `#fete`,
  `#socamusic`,
  `#carnivalcostume`,
  `#mas`,
  `#jouvert`,
  `#caribbeancarnival`,
  `#cropover`,
  `#playmas`,
  `#jabjab`,
  `#socavibes`,
  `#carnivalculture`,
  `#carnival${year}`,
  `#soca${year}`,
];

// Utility: pick N random unique hashtags
function getRandomHashtags(n = 5) {
  const shuffled = [...hashtagPool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n).join(" ");
}

const captionTemplates = [
  `Having fun at the carnival! 🎉`,
  `Another great day for soca and music! 🥳`,
  `Making memories that last forever! 🍹`,
  `Colors, feathers, and pure freedom! 🪶✨`,
  `This is how we do carnival in the islands 🌴🔥`,
  `Soca therapy in full effect! 🎶💃`,
  `Energy too high to calm down 🚀`,
  `Every beat of the drum tells a story 🥁❤️`,
  `Mas is not just a festival, it's a lifestyle 🌟`,
  `From sunrise to sunset, pure carnival spirit 🌞🌙`,
  `When the riddim hits, there's no standing still 🎵⚡`,
  `One love, one people, one carnival 💛💚❤️`,
  `The road is ours today 🛣️👑`,
  `Jump, wave, repeat! 🔁🙌`,
  `Masqueraders bringing the heat 🔥💃`,
  `The Caribbean heartbeat never stops 💓🌊`,
  `Carnival in full effect! 🎭🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩🇻🇨`,
  `From the Caribbean to the world 🌍✨ Mas forever 🇹🇹🇱🇨🇬🇩`,
  `Flags up! Wave it high and rep your island 🙌🏽🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩`,
  `Sweet soca, sweet steelpan, sweet culture 🎶🥁🇧🇧🇹🇹🇱🇨`,
  `Jumpin' with the Caribbean massive 🌴🔥🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩`,
  `Every island, one carnival spirit 🌊❤️💛💚🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩`,
  `The road is life 🚶🏾‍♀️🎉🇧🇧🇹🇹🇱🇨🇬🇩🇯🇲`,
  `Energy from the West Indies can't be matched ⚡🌴🇹🇹🇧🇧🇱🇨🇬🇩`,
  `Wave something! Rag, flag, or cooler cup 🏳️🥤🔥🇹🇹🇱🇨🇬🇩`,
  `We limin', we jammin', we reppin' culture 🍹💃🏽🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩`,
  `Mas is freedom, mas is love ❤️🎭🇹🇹🇱🇨🇬🇩`,
  `One rhythm, one people, one Caribbean 🌍🎶🇹🇹🇯🇲🇧🇧🇱🇨🇬🇩`
];

// Caption builder with credit
function buildCaption(originalUser = null) {
  const randomText = captionTemplates[Math.floor(Math.random() * captionTemplates.length)];
  const hashtags = getRandomHashtags();

  // Ensure #CarnivalCompanion is always included once
  const allTags = `${hashtags} #CarnivalCompanion`
    .split(" ")
    .filter((tag, index, self) => tag && self.indexOf(tag) === index) // remove duplicates
    .join(" ");

  const credit = originalUser ? `\n\n📸 @${originalUser}` : "";
  
  return `${randomText}\n\n${allTags}${credit}`;
}

// -------------------- Persistence --------------------
const sessionFile = "igSession.json";
const historyFile = "postedHistory.json";
let postedHistory = [];

if (fs.existsSync(historyFile)) {
  try {
    postedHistory = JSON.parse(fs.readFileSync(historyFile, "utf8"));
  } catch {
    postedHistory = [];
  }
}

// -------------------- Local Media Functions --------------------
function getRandomLocalMedia() {
  if (!fs.existsSync(localMediaDir)) {
    console.log("📁 Local media directory not found");
    return null;
  }
  
  const files = fs.readdirSync(localMediaDir).filter(f => /\.(jpg|jpeg|png|mp4)$/i.test(f));
  if (files.length === 0) {
    console.log("📁 No media files found in local media directory");
    return null;
  }

  // Exclude already posted local files
  const usedFiles = new Set(postedHistory.filter(h => h.source === "local").map(h => h.id));
  const unused = files.filter(f => !usedFiles.has(f));

  if (unused.length === 0) {
    console.log("⚠️ All local media already posted, will reuse some");
    // Reset local media history if all have been used
    postedHistory = postedHistory.filter(h => h.source !== "local");
    fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));
    return path.join(localMediaDir, files[Math.floor(Math.random() * files.length)]);
  }

  const chosen = unused[Math.floor(Math.random() * unused.length)];
  return path.join(localMediaDir, chosen);
}

// -------------------- Helpers --------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to get video duration
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// Function to extract a frame from video
function extractVideoFrame(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: ["00:00:01"], // 1 second in to avoid black frames
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: '720x1280' // Instagram-friendly size
      })
      .on('end', () => {
        console.log('✅ Frame extracted successfully');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('❌ Error extracting frame:', err);
        reject(err);
      });
  });
}

// Function to decide whether to use logo or video frame
function shouldUseLogo() {
  // 10% chance to use logo
  return Math.random() < 0.1;
}

async function login() {
  ig.state.generateDevice(username);

  if (fs.existsSync(sessionFile)) {
    try {
      await ig.state.deserialize(JSON.parse(fs.readFileSync(sessionFile)));
      console.log("✅ Reused saved Instagram session");
      return;
    } catch {
      console.warn("⚠️ Failed to load saved session, logging in fresh...");
    }
  }

  console.log("🔑 Logging in fresh...");
  await ig.account.login(username, password);
  const serialized = await ig.state.serialize();
  delete serialized.constants;
  fs.writeFileSync(sessionFile, JSON.stringify(serialized, null, 2));
  console.log("🔒 New session saved");
}

// Add this function to refresh the Instagram session
async function refreshSession() {
  try {
    await ig.state.reset();
    await login();
    console.log("✅ Instagram session refreshed");
  } catch (err) {
    console.error("❌ Failed to refresh session:", err.message);
  }
}

// -------------------- Media Fetch Helper --------------------
async function fetchMediaFromAccount(account, preferredType = null) {
  try {
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

    // Normalize items structure
    let items = [];
    if (Array.isArray(response.data?.data?.items)) {
      items = response.data.data.items;
    } else if (Array.isArray(response.data?.items)) {
      items = response.data.items;
    } else if (Array.isArray(response.data)) {
      items = response.data;
    }

    if (!items.length) {
      console.warn(`⚠️ No posts found for @${account}`);
      return null;
    }

    // Prefer type (video=2, image=1), otherwise fallback to first item
    let post = items.find(p => preferredType ? p.media_type === preferredType : true);
    if (!post) post = items[0];

    // Extract media URL
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
      console.warn(`⚠️ Could not find media URL for @${account}`);
      return null;
    }

    return { post, mediaUrl };
  } catch (err) {
    console.error(`❌ Error fetching posts for @${account}:`, err.message);
    return null;
  }
}

// -------------------- Fetch posts via RapidAPI --------------------
let allPosts = [];
let accountsProcessed = 0;

async function fetchPosts(accountName, retry = false) {
  const normalizedName = accountName.toLowerCase().replace(/^\@/, "");
  try {
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

    console.log(`📊 API response for @${accountName}:`, {
      status: response.status,
      dataKeys: Object.keys(response.data || {})
    });

    // Handle different possible response structures
    let items = [];
    if (Array.isArray(response.data?.data?.items)) {
      items = response.data.data.items;
    } else if (Array.isArray(response.data?.items)) {
      items = response.data.items;
    } else if (Array.isArray(response.data)) {
      items = response.data;
    }

    console.log(`📊 Found ${items.length} items for @${accountName}`);
    
    const now = Math.floor(Date.now() / 1000);
    const cutoff = 6 * 3600; // 6 hours in seconds

    // Filter posts from the last 6 hours and not in history
    const recentPosts = items.filter(post => {
      const postTime = post.taken_at || post.timestamp;
      const isRecent = (now - postTime) < cutoff;
      
      // More comprehensive check for already posted content
      const isNew = !postedHistory.some(history => {
        // Check by ID first
        if (history.id === post.id) return true;
        
        // Also check by username and timestamp for additional protection
        if (history.username === post.user?.username && 
            Math.abs(history.timestamp - postTime * 1000) < 60000) {
          return true;
        }
        
        return false;
      });
      
      return isRecent && isNew;
    });

    // Add to allPosts array
    allPosts = allPosts.concat(recentPosts);
    accountsProcessed++;

    console.log(`✅ Found ${recentPosts.length} new posts from @${accountName}`);
  } catch (err) {
    console.error(`❌ Error fetching posts for @${accountName}:`, err.message);
    if (err.response) {
      console.error("Response status:", err.response.status);
      console.error("Response data:", err.response.data);
    }
    if (!retry) {
      console.log("🔄 Retrying in 10 seconds...");
      await sleep(10000);
      return fetchPosts(accountName, true);
    }
  }
}

async function postPlaceholder() {
  // Try local media first
  const localFile = getRandomLocalMedia();
  if (localFile) {
    console.log("📂 Using local media instead of placeholder:", localFile);
    try {
      await login();
      
      if (localFile.endsWith(".mp4")) {
        // Check video duration
        try {
          const duration = await getVideoDuration(localFile);
          if (duration < 3 || duration > 60) {
            console.warn(`⚠️ Skipping invalid video (duration: ${duration}s)`);
            // Try another local file
            const nextFile = getRandomLocalMedia();
            if (nextFile && nextFile !== localFile) {
              console.log("🔄 Trying another local media instead...");
              return postPlaceholder(); // Recursively try again
            } else {
              console.log("⚠️ No more valid local videos, using placeholder...");
              // Fall through to placeholder
            }
          }
        } catch (err) {
          console.error("❌ Error checking video duration:", err.message);
          // Fall through to placeholder
        }
        
        let coverPath = placeholderPath;
        try {
          const tempFramePath = path.join(__dirname, "temp_frame_local.jpg");
          await extractVideoFrame(localFile, tempFramePath);
          coverPath = tempFramePath;
        } catch (err) {
          console.error("⚠️ Failed to grab video frame, using logo");
        }

        await ig.publish.video({
          video: fs.readFileSync(localFile),
          coverImage: fs.readFileSync(coverPath),
          caption: buildCaption(),
        });
      } else {
        await ig.publish.photo({
          file: fs.readFileSync(localFile),
          caption: buildCaption(),
        });
      }
      
      console.log("✅ Local media posted instead of placeholder!");
      return;
    } catch (err) {
      console.error("❌ Failed to post local media:", err.message);
      // Fall through to placeholder
    }
  }

  // Only use placeholder if no local media available
  if (!fs.existsSync(placeholderPath)) {
    console.error("❌ Placeholder image missing!");
    return;
  }

  try {
    await login();
    const buffer = fs.readFileSync(placeholderPath);
    
    await ig.publish.photo({
      file: buffer,
      caption: buildCaption(),
    });
    console.log("✅ Placeholder image posted");
  } catch (err) {
    console.error("❌ Failed to post placeholder:", err.message);
  }
}

// -------------------- Schedule & Post --------------------
// Peak engagement times (in 24-hour format)
const PEAK_HOURS = [
  { start: 9, end: 11 },   // Morning peak
  { start: 13, end: 15 },  // Afternoon peak
  { start: 19, end: 21 }   // Evening peak
];

// Total posts per day (increased from 6 to 8-10)
const MIN_POSTS_PER_DAY = 8;
const MAX_POSTS_PER_DAY = 10;

// Helper function to get random time within peak hours
function getRandomPeakTime() {
  const peakSlot = PEAK_HOURS[Math.floor(Math.random() * PEAK_HOURS.length)];
  const hour = peakSlot.start + Math.floor(Math.random() * (peakSlot.end - peakSlot.start));
  const minute = Math.floor(Math.random() * 60);
  
  const now = new Date();
  const scheduledDate = new Date(now);
  scheduledDate.setHours(hour, minute, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (scheduledDate < now) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  }
  
  return scheduledDate;
}

// Helper function to get random time during non-peak hours (but still within 6am-10pm)
function getRandomOffPeakTime() {
  const hour = 6 + Math.floor(Math.random() * 16); // 6am to 10pm
  const minute = Math.floor(Math.random() * 60);
  
  const now = new Date();
  const scheduledDate = new Date(now);
  scheduledDate.setHours(hour, minute, 0, 0);
  
  // If the time has already passed today, schedule for tomorrow
  if (scheduledDate < now) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  }
  
  return scheduledDate;
}

// Helper function to check if a time is within peak hours
function isPeakTime(date) {
  const hour = date.getHours();
  return PEAK_HOURS.some(peak => hour >= peak.start && hour < peak.end);
}

// Helper function to schedule a local media post
function scheduleLocalMediaPost(localFile, scheduledDate) {
  schedule.scheduleJob(scheduledDate, async () => {
    let tempFramePath = null;
    
    try {
      await refreshSession();

      if (localFile.endsWith(".mp4")) {
        // Check video duration
        try {
          const duration = await getVideoDuration(localFile);
          if (duration < 3 || duration > 60) {
            console.warn(`⚠️ Skipping invalid video (duration: ${duration}s)`);
            // Try another local file
            const nextFile = getRandomLocalMedia();
            if (nextFile && nextFile !== localFile) {
              console.log("🔄 Trying another local media instead...");
              return scheduleLocalMediaPost(nextFile, scheduledDate);
            } else {
              console.log("⚠️ No more valid local videos, skipping...");
              return;
            }
          }
        } catch (err) {
          console.error("❌ Error checking video duration:", err.message);
          return;
        }
        
        // Extract frame or use logo
        let coverPath = placeholderPath;
        try {
          tempFramePath = path.join(__dirname, "temp_frame_local.jpg");
          await extractVideoFrame(localFile, tempFramePath);
          coverPath = tempFramePath;
          console.log("🎬 Using video frame as cover image");
        } catch (err) {
          console.error("⚠️ Failed to grab video frame, using logo");
        }

        await ig.publish.video({
          video: fs.readFileSync(localFile),
          coverImage: fs.readFileSync(coverPath),
          caption: buildCaption(),
        });
        console.log("✅ Local video posted!");
      } else {
        await ig.publish.photo({
          file: fs.readFileSync(localFile),
          caption: buildCaption(),
        });
        console.log("✅ Local photo posted!");
      }

      // Save to history
      const historyItem = { 
        id: path.basename(localFile),
        timestamp: Date.now(),
        username: "local",
        media_type: localFile.endsWith(".mp4") ? 2 : 1,
        success: true,
        source: "local"
      };

      postedHistory.push(historyItem);

      // Keep only the most recent 1000 items to prevent the file from growing too large
      if (postedHistory.length > 1000) {
        postedHistory = postedHistory.slice(-1000);
      }

      fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));

    } catch (err) {
      console.error("❌ Error posting local media:", err.message);
      await postPlaceholder();
    } finally {
      // Clean up temporary files
      if (tempFramePath && fs.existsSync(tempFramePath)) {
        fs.unlinkSync(tempFramePath);
        console.log("🧹 Cleaned up temporary frame file");
      }
    }
  });
}

// Helper function to schedule an API-sourced post
function scheduleApiPost(post, scheduledDate) {
  schedule.scheduleJob(scheduledDate, async () => {
    let tempVideoPath = null;
    let tempFramePath = null;
    
    try {
      await refreshSession();
      const account = post.user?.username;

      const fetched = await fetchMediaFromAccount(account, post.media_type);
      if (!fetched) {
        console.log("⚠️ No valid media found, posting placeholder...");
        await postPlaceholder();
        return;
      }

      const { post: freshPost, mediaUrl } = fetched;

      if (freshPost.media_type === 2) {
        console.log(`📤 Posting video from @${account}`);
        
        // Download video
        const res = await axios.get(mediaUrl, { 
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://www.instagram.com/',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Mode': 'no-cors'
          }
        });
        
        // Save video to temporary file
        tempVideoPath = path.join(__dirname, "temp_video.mp4");
        fs.writeFileSync(tempVideoPath, res.data);
        
        // Check video duration
        try {
          const duration = await getVideoDuration(tempVideoPath);
          if (duration < 3 || duration > 60) {
            console.warn(`⚠️ Skipping API video (duration: ${duration}s)`);
            return; // Skip this post
          }
        } catch (err) {
          console.error("❌ Error checking video duration:", err.message);
          return; // Skip this post
        }
        
        try {
          // Decide whether to use logo or video frame
          let coverImagePath = placeholderPath;
          
          if (!shouldUseLogo()) {
            try {
              tempFramePath = path.join(__dirname, "temp_frame.jpg");
              await extractVideoFrame(tempVideoPath, tempFramePath);
              coverImagePath = tempFramePath;
              console.log("🎬 Using video frame as cover image");
            } catch (frameErr) {
              console.error("❌ Failed to extract frame, using logo instead:", frameErr.message);
              coverImagePath = placeholderPath;
            }
          } else {
            console.log("🎲 Using logo as cover image (10% chance)");
          }
          
          // Post video
          const publishResult = await ig.publish.video({
            video: fs.readFileSync(tempVideoPath),
            coverImage: fs.readFileSync(coverImagePath),
            caption: buildCaption(account),
          });
          
          console.log("✅ Video posted successfully!", publishResult);
        } catch (videoErr) {
          console.error("❌ Video posting failed:", videoErr.message);
          
          // Try fallback to image
          console.log("🔄 Trying to post as image instead...");
          try {
            await ig.publish.photo({
              file: fs.readFileSync(placeholderPath),
              caption: buildCaption(account),
            });
            console.log("✅ Fallback image posted successfully!");
          } catch (imageErr) {
            console.error("❌ Fallback image posting failed:", imageErr.message);
            throw imageErr;
          }
        }
      } else {
        console.log(`📤 Posting image from @${account}`);
        
        // Download image
        const res = await axios.get(mediaUrl, { 
          responseType: "arraybuffer",
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        await ig.publish.photo({
          file: Buffer.from(res.data),
          caption: buildCaption(account),
        });
        console.log("✅ Image posted successfully!");
      }

      // Enhanced history tracking
      const historyItem = { 
        id: freshPost.id, 
        timestamp: Date.now(),
        username: account,
        media_type: freshPost.media_type,
        success: true,
        source: "api"
      };

      postedHistory.push(historyItem);

      // Keep only the most recent 1000 items to prevent the file from growing too large
      if (postedHistory.length > 1000) {
        postedHistory = postedHistory.slice(-1000);
      }

      fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));

      console.log("✅ Post successful!");
    } catch (err) {
      console.error("❌ Error posting:", err.message);
      await postPlaceholder();
    } finally {
      // Clean up temporary files
      if (tempVideoPath && fs.existsSync(tempVideoPath)) {
        fs.unlinkSync(tempVideoPath);
        console.log("🧹 Cleaned up temporary video file");
      }
      if (tempFramePath && fs.existsSync(tempFramePath)) {
        fs.unlinkSync(tempFramePath);
        console.log("🧹 Cleaned up temporary frame file");
      }
    }
  });
}

function schedulePosts() {
  const totalPosts = Math.floor(Math.random() * (MAX_POSTS_PER_DAY - MIN_POSTS_PER_DAY + 1)) + MIN_POSTS_PER_DAY;
  console.log(`📅 Scheduling ${totalPosts} posts for today`);
  
  // First, post immediately for confirmation
  const localFile = getRandomLocalMedia();
  if (localFile) {
    console.log("⚡ Posting local media immediately for confirmation...");
    scheduleLocalMediaPost(localFile, new Date());
  } else if (allPosts.length > 0) {
    const firstPost = allPosts[0];
    console.log("⚡ Posting API content immediately for confirmation...");
    scheduleApiPost(firstPost, new Date());
  } else {
    console.log("⚠️ No content found, posting placeholder...");
    postPlaceholder();
    return;
  }

  // Schedule remaining posts with priority to peak hours
  const postsToSchedule = totalPosts - 1;
  const availableApiPosts = allPosts.length - 1;
  const availableLocalPosts = Math.max(0, postsToSchedule - availableApiPosts);
  
  let apiPostsScheduled = 0;
  let localPostsScheduled = 0;
  
  // Schedule API posts first (preferred content)
  for (let i = 0; i < Math.min(availableApiPosts, postsToSchedule); i++) {
    const post = allPosts[i + 1];
    
    // 70% chance to schedule during peak hours for API content
    const scheduledDate = Math.random() < 0.7 ? getRandomPeakTime() : getRandomOffPeakTime();
    
    console.log(`📅 Scheduled API post ${i+2}/${totalPosts} for ${scheduledDate.toLocaleString()} ${isPeakTime(scheduledDate) ? '⏰(PEAK)' : ''}`);
    scheduleApiPost(post, scheduledDate);
    apiPostsScheduled++;
  }
  
  // Schedule local media posts for remaining slots
  for (let i = 0; i < availableLocalPosts; i++) {
    const localFile = getRandomLocalMedia();
    if (localFile) {
      // 50% chance to schedule during peak hours for local content
      const scheduledDate = Math.random() < 0.5 ? getRandomPeakTime() : getRandomOffPeakTime();
      
      console.log(`📅 Scheduled local media post ${apiPostsScheduled + i + 2}/${totalPosts} for ${scheduledDate.toLocaleString()} ${isPeakTime(scheduledDate) ? '⏰(PEAK)' : ''}`);
      scheduleLocalMediaPost(localFile, scheduledDate);
      localPostsScheduled++;
    } else {
      console.log("⚠️ Not enough local media for additional posts");
      break;
    }
  }
  
  // If we still need more posts, reuse some content (with different timing)
  const remainingPosts = totalPosts - 1 - apiPostsScheduled - localPostsScheduled;
  if (remainingPosts > 0) {
    console.log(`🔄 Reusing ${remainingPosts} posts with different timing`);
    
    // Reuse some API posts with different scheduling
    const reuseCount = Math.min(remainingPosts, allPosts.length - 1);
    for (let i = 0; i < reuseCount; i++) {
      const post = allPosts[(i + apiPostsScheduled + 1) % allPosts.length];
      const scheduledDate = getRandomOffPeakTime(); // Always off-peak for reused content
      
      console.log(`📅 Reused API post ${totalPosts - remainingPosts + i + 1}/${totalPosts} for ${scheduledDate.toLocaleString()}`);
      scheduleApiPost(post, scheduledDate);
    }
  }
  
  console.log(`✅ Scheduled ${totalPosts} posts total: ${apiPostsScheduled} API + ${localPostsScheduled} local`);
}

// -------------------- Runner --------------------
async function fetchAllAccountsSequentially() {
  accountsProcessed = 0;
  allPosts = [];
  for (let acc of accounts) {
    console.log(`⏳ Fetching posts for @${acc}...`);
    await fetchPosts(acc);
    await sleep(10000);
  }
  
  // Add this line to schedule posts after fetching
  schedulePosts();
}

// -------------------- Test post (videos → images → placeholder) --------------------
async function testPost() {
  let tempVideoPath = null;
  let tempFramePath = null;

  try {
    console.log("🔑 Running test post...");

    // Check for local media first
    const localFile = getRandomLocalMedia();
    if (localFile) {
      console.log("🧪 Test mode: posting local media", localFile);

      await login();
      const buffer = fs.readFileSync(localFile);

      if (localFile.endsWith(".mp4")) {
        // Check video duration
        try {
          const duration = await getVideoDuration(localFile);
          if (duration < 3 || duration > 60) {
            console.warn(`⚠️ Skipping invalid video (duration: ${duration}s)`);
            // Try another local file
            const nextFile = getRandomLocalMedia();
            if (nextFile && nextFile !== localFile) {
              console.log("🔄 Trying another local media instead...");
              return testPost(); // Recursively try again
            } else {
              console.log("⚠️ No more valid local videos, using API content...");
            }
          }
        } catch (err) {
          console.error("❌ Error checking video duration:", err.message);
        }

        let coverPath = placeholderPath;
        try {
          tempFramePath = path.join(__dirname, "temp_frame_local.jpg");
          await extractVideoFrame(localFile, tempFramePath);
          coverPath = tempFramePath;
          console.log("🎬 Using video frame as cover image");
        } catch (err) {
          console.error("⚠️ Failed to grab frame, using logo");
        }

        await ig.publish.video({
          video: buffer,
          coverImage: fs.readFileSync(coverPath),
          caption: buildCaption(),
        });
        console.log("✅ Local video test post complete");
      } else {
        await ig.publish.photo({
          file: buffer,
          caption: buildCaption(),
        });
        console.log("✅ Local photo test post complete");
      }

      // Save to history
      postedHistory.push({
        id: path.basename(localFile),
        timestamp: Date.now(),
        username: "local",
        media_type: localFile.endsWith(".mp4") ? 2 : 1,
        success: true,
        source: "local",
      });
      fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));
      return;
    }

    // -------------------- API fallback --------------------
    await login();
    for (let account of accounts) {
      const result = await fetchMediaFromAccount(account, 2); // Prefer video
      if (result) {
        console.log(`✅ Found video from @${account}`);

        // Download video
        const res = await axios.get(result.mediaUrl, {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });

        tempVideoPath = path.join(__dirname, "temp_video.mp4");
        fs.writeFileSync(tempVideoPath, res.data);

        // Check duration
        try {
          const duration = await getVideoDuration(tempVideoPath);
          if (duration < 3 || duration > 60) {
            console.warn(`⚠️ Skipping API video (duration: ${duration}s)`);
            continue; // Try next account
          }
        } catch (err) {
          console.error("❌ Error checking video duration:", err.message);
          continue;
        }

        let coverImagePath = placeholderPath;
        if (!shouldUseLogo()) {
          try {
            tempFramePath = path.join(__dirname, "temp_frame.jpg");
            await extractVideoFrame(tempVideoPath, tempFramePath);
            coverImagePath = tempFramePath;
            console.log("🎬 Using video frame as cover image");
          } catch (frameErr) {
            console.error("⚠️ Failed to grab frame, using logo");
          }
        }

        await ig.publish.video({
          video: fs.readFileSync(tempVideoPath),
          coverImage: fs.readFileSync(coverImagePath),
          caption: buildCaption(account),
        });
        console.log("✅ API video test post complete");
        return;
      }
    }

    // -------------------- Placeholder fallback --------------------
    console.log("⚠️ No local or API media found, posting placeholder...");
    await ig.publish.photo({
      file: fs.readFileSync(placeholderPath),
      caption: buildCaption(),
    });
    console.log("✅ Placeholder test post complete");
  } catch (err) {
    console.error("❌ Test post failed:", err.message);
  } finally {
    if (tempVideoPath && fs.existsSync(tempVideoPath)) {
      fs.unlinkSync(tempVideoPath);
      console.log("🧹 Cleaned up temporary video file");
    }
    if (tempFramePath && fs.existsSync(tempFramePath)) {
      fs.unlinkSync(tempFramePath);
      console.log("🧹 Cleaned up temporary frame file");
    }
  }
}

// -------------------- Runner --------------------
(async () => {
  console.log("Running on Render:", process.env.RENDER || false);

  if (process.argv.includes("--test")) {
    console.log("🔍 Running in test mode...");
    await testPost();
    console.log("✅ Test completed");
    process.exit(0);
  } else {
    console.log("🔍 Running in scheduled mode...");
    await login();
    await fetchAllAccountsSequentially();
  }
})();
