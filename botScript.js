// botScript.js
require("dotenv").config();

// External libraries
const { IgApiClient } = require("instagram-private-api");
const axios = require("axios");
const schedule = require("node-schedule");
const fs = require("fs");
const moment = require("moment-timezone");

// -------------------- Config --------------------
const accounts = [
  "carnivalsaintlucia",
  "socaleaks",
  "jabjabofficial",
  "fuzionmas",
  "yardmascarnival",
];

const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

// Basic safety check
if (!username || !password || !rapidApiKey) {
  console.error("❌ Missing environment variables. Make sure IG_USERNAME, IG_PASSWORD and RAPIDAPI_KEY are set.");
  process.exit(1);
}

// posting window (used to randomize schedule)
const postingHours = 6; // schedule within next 6 hours

// Instagram client
const ig = new IgApiClient();

// Static fallback captions (used if you don't want AI or if AI fails)
const captions = [
  "Having fun at the carnival! 😊",
  "Another great day for adventures! 🎉",
  "Making memories that last forever! 🍹",
];
const getRandomCaption = () => captions[Math.floor(Math.random() * captions.length)];

// -------------------- Persistence --------------------
// Session file for instagram-private-api (so you don't re-login every run)
const sessionFile = "igSession.json";

// History for duplicate prevention, keep last 5 days
const historyFile = "postedHistory.json";
let postedHistory = [];
if (fs.existsSync(historyFile)) {
  try {
    postedHistory = JSON.parse(fs.readFileSync(historyFile, "utf8"));
  } catch (e) {
    postedHistory = [];
  }
}
function clearOldHistory() {
  const cutoff = Date.now() - 5 * 24 * 60 * 60 * 1000; // 5 days
  postedHistory = postedHistory.filter((h) => h.timestamp > cutoff);
  try {
    fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));
  } catch (e) {
    console.warn("Failed to write history file:", e.message);
  }
}
clearOldHistory();

// -------------------- Helpers --------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------- Login w/ session persistence --------------------
async function login() {
  ig.state.generateDevice(username);

  // Try restore
  if (fs.existsSync(sessionFile)) {
    try {
      const raw = fs.readFileSync(sessionFile, "utf8");
      const deserialized = JSON.parse(raw);
      await ig.state.deserialize(deserialized);
      console.log("✅ Reused saved Instagram session");
      return;
    } catch (err) {
      console.warn("⚠️ Failed to deserialize saved session, will do fresh login:", err.message);
    }
  }

  // Fresh login
  console.log("🔑 Logging in to Instagram...");
  await ig.account.login(username, password);
  try {
    const serialized = await ig.state.serialize();
    // Remove sensitive or big fields if any
    delete serialized.constants;
    fs.writeFileSync(sessionFile, JSON.stringify(serialized, null, 2));
    console.log("🔒 Session saved to", sessionFile);
  } catch (err) {
    console.warn("⚠️ Failed to save session:", err.message);
  }
}

// -------------------- Fetch posts via RapidAPI instagram120 provider --------------------
// Uses POST https://instagram120.p.rapidapi.com/api/instagram/posts
// The response structure differs between providers; this function maps to a normalized shape.
let allVideos = [];
let accountsProcessed = 0;

async function fetchVideos(accountName, retry = false) {
  const normalizedName = accountName.toLowerCase().replace(/^\@/, "");
  try {
    const response = await axios.post(
      "https://instagram120.p.rapidapi.com/api/instagram/posts",
      { username: normalizedName, maxId: "" },
      {
        headers: {
          "x-rapidapi-key": rapidApiKey,
          "x-rapidapi-host": "instagram120.p.rapidapi.com",
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    const jsonResponse = response.data;
    fs.writeFileSync(`lastApiResponse-${normalizedName}.json`, JSON.stringify(jsonResponse, null, 2));

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const timeLimit = 23 * 3600 + 45 * 60; // 23h45m

    let videoPostsInfo = [];

    // Many providers return `result` array; adapt if it's different.
    const items = Array.isArray(jsonResponse.result) ? jsonResponse.result : jsonResponse.items || [];

    if (Array.isArray(items)) {
      videoPostsInfo = items
        .filter((it) => {
          // Normalized checks — adapt if provider uses different fields
          const isVideo = it.is_video === true || it.media_type === 2;
          const hasUrl = !!(it.video_url || it.videoUrl || it.media_url);
          const taken = it.taken_at_timestamp || it.taken_at || it.taken_at_ts || it.taken_at_time;
          if (!isVideo || !hasUrl || !taken) return false;
          // within time window
          return nowInSeconds - (it.taken_at_timestamp || it.taken_at || it.taken_at_ts || 0) <= timeLimit;
        })
        .map((it) => {
          const videoUrl = it.video_url || it.videoUrl || it.media_url;
          const takenAt = it.taken_at_timestamp || it.taken_at || it.taken_at_ts || Math.floor(Date.now() / 1000);
          const randomFuture = Math.floor(Math.random() * postingHours * 3600);
          const postTimeUnix = Math.floor(Date.now() / 1000) + randomFuture;
          const dateEST = moment.tz(postTimeUnix * 1000, "America/New_York").toDate();

          return {
            id: it.id || `${normalizedName}_${takenAt}`,
            taken_at_timestamp: takenAt,
            display_url: it.display_url || it.thumbnail_url || it.thumbnail || null,
            video_url: videoUrl,
            owner: { username: normalizedName },
            post_time: postTimeUnix,
            real_time: dateEST.toISOString(),
          };
        });
    }

    // Filter duplicates using postedHistory
    const newVideos = videoPostsInfo.filter((v) => !postedHistory.find((h) => h.id === v.id));
    if (newVideos.length) {
      console.log(`➕ Found ${newVideos.length} new video(s) for ${normalizedName}`);
    } else {
      console.log(`— No new videos for ${normalizedName}`);
    }
    allVideos = allVideos.concat(newVideos);
  } catch (err) {
    // handle rate limits and other errors
    const status = err?.response?.status;
    if (status === 429 && !retry) {
      console.warn(`⚠️ 429 for ${normalizedName}. Waiting 30s then retrying...`);
      await sleep(30000);
      return fetchVideos(accountName, true);
    } else if (status === 404) {
      console.warn(`⚠️ 404 Not found for ${normalizedName} (provider or account may not exist / subscription issue)`);
    } else {
      console.error(`❌ Error fetching ${normalizedName}:`, err.message);
    }
  } finally {
    accountsProcessed++;
    if (accountsProcessed === accounts.length) {
      saveAndScheduleAllVideos();
    }
  }
}

// -------------------- Save & schedule --------------------
function saveAndScheduleAllVideos() {
  clearOldHistory(); // maintain history before scheduling

  if (!allVideos.length) {
    console.log("No videos collected — nothing to schedule.");
    return;
  }

  allVideos.sort((a, b) => a.post_time - b.post_time);
  try {
    fs.writeFileSync("scheduledVideos.json", JSON.stringify(allVideos, null, 2));
  } catch (e) {
    console.warn("Failed to write scheduledVideos.json:", e.message);
  }
  console.log(`Saved ${allVideos.length} scheduled video(s). Scheduling now...`);

  allVideos.forEach((video) => {
    const scheduledDate = new Date(video.post_time * 1000);

    // If scheduledDate is in the past, post immediately (with small delay)
    const now = Date.now();
    const when = scheduledDate.getTime() < now ? new Date(now + 5000) : scheduledDate;

    schedule.scheduleJob(when, async () => {
      try {
        console.log(`📤 Posting video ${video.id} from ${video.owner?.username} at ${new Date().toISOString()}`);

        // ensure logged in (session persistence)
        await login();

        // download video
        const res = await axios.get(video.video_url, { responseType: "arraybuffer", timeout: 30000 });
        const videoBuffer = Buffer.from(res.data);

        // publish
        await ig.publish.video({
          video: videoBuffer,
          coverFrame: 0,
          caption: getRandomCaption(),
        });

        console.log("✅ Video posted successfully!");

        // record in history to avoid duplicates
        postedHistory.push({ id: video.id, timestamp: Date.now() });
        try {
          fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2));
        } catch (e) {
          console.warn("Failed to write posted history:", e.message);
        }
      } catch (err) {
        console.error("❌ Error while posting video:", err?.message || err);
      }
    });
  });
}

// -------------------- Test post --------------------
async function testPost() {
  try {
    console.log("🔑 Running test post...");
    await login();

    let videoBuffer;
    if (fs.existsSync("test.mp4")) {
      console.log("Using local test.mp4");
      videoBuffer = fs.readFileSync("test.mp4");
    } else {
      const testVideoUrl = "https://filesamples.com/samples/video/mp4/sample_640x360.mp4";
      console.log("Downloading sample video...");
      const resp = await axios.get(testVideoUrl, { responseType: "arraybuffer", timeout: 30000 });
      videoBuffer = Buffer.from(resp.data);
    }

    await ig.publish.video({
      video: videoBuffer,
      coverFrame: 0,
      caption: "🚀 Test post successful!",
    });

    console.log("✅ Test post complete.");
    // Add nothing to history by default — test-only.
  } catch (err) {
    console.error("❌ Test post failed:", err?.message || err);
  }
}

// -------------------- Runner --------------------
async function fetchAllAccountsSequentially() {
  accountsProcessed = 0;
  allVideos = [];
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log(`⏳ Fetching videos for ${acc} (${i + 1}/${accounts.length})...`);
    await fetchVideos(acc);
    // 10s gap between account fetches
    await sleep(10000);
  }
}

// Entrypoint
if (process.argv.includes("--test")) {
  testPost();
} else {
  fetchAllAccountsSequentially();
}
