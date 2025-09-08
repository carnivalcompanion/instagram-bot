// External libraries
const { IgApiClient } = require('instagram-private-api');
const axios = require('axios');                // replacing deprecated request
const schedule = require('node-schedule');
const fs = require('fs');
const moment = require('moment-timezone');
const http = require('http');

// Accounts to pull from
const accounts = [
  'Carnivalsaintlucia',
];

// Config (moved to env vars for safety)
const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

// Schedule config
const startHour = 20;   // 8 PM EST
const startMin = 30;    // 8:30 PM EST
const postingHours = 6; // hours of posting window

// Instagram client
const ig = new IgApiClient();

// Captions
const captions = [
  'Having fun at the carnival! 😊',
  'Another great day for adventures! 😊',
  'Making memories that last forever! 🍹'
];
const getRandomCaption = () =>
  captions[Math.floor(Math.random() * captions.length)];

// Data collectors
let allVideos = [];
let accountsProcessed = 0;

// Fetch videos for a given account (with retry support)
async function fetchVideos(accountName, retry = false) {
  try {
    const response = await axios.get(
      `https://instagram-premium-api-2023.p.rapidapi.com/feed/${accountName}`,
      {
        headers: {
          'X-RapidAPI-Key': rapidApiKey,
          'X-RapidAPI-Host': 'instagram-premium-api-2023.p.rapidapi.com'
        }
      }
    );

    const jsonResponse = response.data;
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const timeLimit = 23 * 3600 + 45 * 60; // 23h 45m

    let videoPostsInfo = [];

    // Try the different API response structures
    if (
      jsonResponse.data &&
      jsonResponse.data.user &&
      jsonResponse.data.user.edge_owner_to_timeline_media
    ) {
      videoPostsInfo = jsonResponse.data.user.edge_owner_to_timeline_media.edges
        .filter(
          edge =>
            edge.node.is_video &&
            nowInSeconds - edge.node.taken_at_timestamp <= timeLimit
        )
        .map(edge => {
          const randomFutureTimeInSeconds = Math.floor(
            Math.random() * postingHours * 3600
          );
          const postTimeUnix = nowInSeconds + randomFutureTimeInSeconds;
          const dateEST = moment
            .tz(postTimeUnix * 1000, 'America/New_York')
            .toDate();

          return {
            taken_at_timestamp: edge.node.taken_at_timestamp,
            display_url: edge.node.display_url,
            video_url: edge.node.video_url,
            owner: edge.node.owner,
            post_time: postTimeUnix,
            real_time: dateEST.toISOString()
          };
        });
    } else if (jsonResponse.items) {
      videoPostsInfo = jsonResponse.items
        .filter(
          item => item.is_video && nowInSeconds - item.taken_at <= timeLimit
        )
        .map(item => {
          const randomFutureTimeInSeconds = Math.floor(
            Math.random() * postingHours * 3600
          );
          const postTimeUnix = nowInSeconds + randomFutureTimeInSeconds;
          const dateEST = moment
            .tz(postTimeUnix * 1000, 'America/New_York')
            .toDate();

          return {
            taken_at_timestamp: item.taken_at,
            display_url:
              item.image_versions2?.candidates?.[0]?.url ||
              item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url,
            video_url: item.video_versions?.[0]?.url,
            owner: item.user,
            post_time: postTimeUnix,
            real_time: dateEST.toISOString()
          };
        });
    }

    allVideos = allVideos.concat(videoPostsInfo);
  } catch (error) {
    if (error.response && error.response.status === 429 && !retry) {
      console.warn(`⚠️ 429 Too Many Requests for ${accountName}. Retrying in 30s...`);
      await sleep(30000); // wait 30 seconds
      return fetchVideos(accountName, true); // retry once
    } else {
      console.error(`Error fetching videos for ${accountName}:`, error.message);
    }
  } finally {
    accountsProcessed++;
    if (accountsProcessed === accounts.length) {
      saveAndScheduleAllVideos();
    }
  }
}

// Save and schedule all fetched videos
function saveAndScheduleAllVideos() {
  if (!allVideos.length) {
    console.log("No videos collected — nothing to schedule.");
    return;
  }

  // Sort videos by post_time (earliest first)
  allVideos.sort((a, b) => a.post_time - b.post_time);

  // Save to file (for debugging/record-keeping)
  fs.writeFileSync("scheduledVideos.json", JSON.stringify(allVideos, null, 2));
  console.log(`Saved ${allVideos.length} videos to scheduledVideos.json`);

  // Schedule each post
  allVideos.forEach(video => {
    const scheduledDate = new Date(video.post_time * 1000);

    schedule.scheduleJob(scheduledDate, async () => {
      try {
        console.log(`Posting video from ${video.owner?.username || "unknown"} at ${scheduledDate}`);

        // Login if not already logged in
        ig.state.generateDevice(username);
        await ig.account.login(username, password);

        // Upload video
        const videoBuffer = await axios.get(video.video_url, { responseType: "arraybuffer" });
        await ig.publish.video({
          video: Buffer.from(videoBuffer.data),
          coverFrame: 0, // default cover frame
          caption: getRandomCaption(),
        });

        console.log("✅ Video posted successfully!");
      } catch (err) {
        console.error("❌ Error posting video:", err.message);
      }
    });
  });
}

// Manual test post function (with local fallback)
async function testPost() {
  try {
    console.log("🔑 Logging into Instagram for test post...");
    ig.state.generateDevice(username);
    await ig.account.login(username, password);

    let videoBuffer;

    if (fs.existsSync("test.mp4")) {
      console.log("🎥 Using local test.mp4 for upload...");
      videoBuffer = fs.readFileSync("test.mp4");
    } else {
      console.log("🌐 No local file found, downloading sample video...");
      const testVideoUrl = "https://filesamples.com/samples/video/mp4/sample_640x360.mp4";
      const response = await axios.get(testVideoUrl, { responseType: "arraybuffer" });
      videoBuffer = Buffer.from(response.data);
    }

    await ig.publish.video({
      video: videoBuffer,
      coverFrame: 0,
      caption: "🚀 Test post successful! (Uploaded from test.mp4 or fallback)"
    });

    console.log("✅ Test video posted successfully!");
  } catch (err) {
    console.error("❌ Test post failed:", err.message);
  }
}

// Helper to delay execution
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Sequentially fetch videos with a delay to avoid 429 errors
async function fetchAllAccountsSequentially() {
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log(`⏳ Fetching videos for ${acc} (account ${i + 1}/${accounts.length})...`);
    await fetchVideos(acc);

    // wait 10 seconds between requests to reduce 429 errors
    await sleep(10000);
  }
}

// Check command-line args
if (process.argv.includes("--test")) {
  testPost();
} else {
  // Normal run: fetch videos sequentially (avoids 429 errors + retries once on fail)
  fetchAllAccountsSequentially();
}
