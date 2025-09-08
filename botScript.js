// External libraries
const { IgApiClient } = require("instagram-private-api");
const axios = require("axios");
const schedule = require("node-schedule");
const fs = require("fs");
const moment = require("moment-timezone");

// Accounts to pull from
const accounts = [
  "carnivalsaintlucia",
  "Socaleaks",
  "jabjabofficial",
  "fuzionmas",
  "yardmascarnival",
];

// Config (from env vars)
const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

// Instagram client
const ig = new IgApiClient();

// Captions
const captions = [
  "Having fun at the carnival! 😊",
  "Another great day for adventures! 🎉",
  "Making memories that last forever! 🍹",
];
const getRandomCaption = () =>
  captions[Math.floor(Math.random() * captions.length)];

// Data collectors
let allVideos = [];
let accountsProcessed = 0;

// ===============================
// 🔑 LOGIN WITH SESSION PERSISTENCE
// ===============================
async function login() {
  ig.state.generateDevice(username);

  if (fs.existsSync("igSession.json")) {
    try {
      const savedSession = JSON.parse(fs.readFileSync("igSession.json"));
      await ig.state.deserialize(savedSession);
      console.log("✅ Reused saved Instagram session");
      return;
    } catch (err) {
      console.warn("⚠️ Failed to load saved session, logging in fresh...");
    }
  }

  // Fresh login
  await ig.account.login(username, password);
  const serialized = await ig.state.serialize();
  delete serialized.constants; // not needed
  fs.writeFileSync("igSession.json", JSON.stringify(serialized));
  console.log("🔑 Logged in fresh & saved new session");
}

// ===============================
// 📥 Fetch videos via RapidAPI
// ===============================
async function fetchVideos(accountName, retry = false) {
  const normalizedName = accountName.toLowerCase();
  try {
    const response = await axios.get(
      "https://instagram-social-api.p.rapidapi.com/v1/posts",
      {
        headers: {
          "x-rapidapi-key": rapidApiKey,
          "x-rapidapi-host": "instagram-social-api.p.rapidapi.com",
        },
        params: { username_or_id_or_url: normalizedName },
      }
    );

    const jsonResponse = response.data;

    fs.writeFileSync(
      `lastApiResponse-${normalizedName}.json`,
      JSON.stringify(jsonResponse, null, 2)
    );

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const timeLimit = 23 * 3600 + 45 * 60; // 23h45m

    let videoPostsInfo = [];

    if (jsonResponse?.data?.items) {
      videoPostsInfo = jsonResponse.data.items
        .filter(
          (item) =>
            item.media_type === 2 &&
            item.video_versions?.length > 0 &&
            nowInSeconds - item.taken_at <= timeLimit
        )
        .map((item) => {
          const videoUrl = item.video_versions[0]?.url;
          const randomFutureTimeInSeconds = Math.floor(Math.random() * 6 * 3600);
          const postTimeUnix = nowInSeconds + randomFutureTimeInSeconds;
          const dateEST = moment
            .tz(postTimeUnix * 1000, "America/New_York")
            .toDate();

          return {
            id: item.id,
            video_url: videoUrl,
            owner: { username: item.user?.username || normalizedName },
            post_time: postTimeUnix,
            real_time: dateEST.toISOString(),
          };
        });
    }

    allVideos = allVideos.concat(videoPostsInfo);
  } catch (error) {
    if (error.response?.status === 429 && !retry) {
      console.warn(`⚠️ 429 Too Many Requests for ${normalizedName}. Retrying in 30s...`);
      await sleep(30000);
      return fetchVideos(normalizedName, true);
    } else if (error.response?.status === 404) {
      console.warn(`⚠️ Skipping ${normalizedName} — not found (404).`);
    } else {
      console.error(`❌ Error fetching videos for ${normalizedName}:`, error.message);
    }
  } finally {
    accountsProcessed++;
    if (accountsProcessed === accounts.length) {
      saveAndScheduleAllVideos();
    }
  }
}

// ===============================
// ⏰ Save and schedule posts
// ===============================
function saveAndScheduleAllVideos() {
  if (!allVideos.length) {
    console.log("No videos collected — nothing to schedule.");
    return;
  }

  allVideos.sort((a, b) => a.post_time - b.post_time);
  fs.writeFileSync("scheduledVideos.json", JSON.stringify(allVideos, null, 2));
  console.log(`Saved ${allVideos.length} videos to scheduledVideos.json`);

  allVideos.forEach((video) => {
    const scheduledDate = new Date(video.post_time * 1000);

    schedule.scheduleJob(scheduledDate, async () => {
      try {
        console.log(`📤 Posting video from ${video.owner?.username} at ${scheduledDate}`);

        await login(); // ensure logged in

        const videoBuffer = await axios.get(video.video_url, { responseType: "arraybuffer" });
        await ig.publish.video({
          video: Buffer.from(videoBuffer.data),
          coverFrame: 0,
          caption: getRandomCaption(),
        });

        console.log("✅ Video posted successfully!");
      } catch (err) {
        console.error("❌ Error posting video:", err.message);
      }
    });
  });
}

// ===============================
// 🧪 Manual test post
// ===============================
async function testPost() {
  try {
    await login();

    let videoBuffer;
    if (fs.existsSync("test.mp4")) {
      console.log("🎥 Using local test.mp4...");
      videoBuffer = fs.readFileSync("test.mp4");
    } else {
      console.log("🌐 Downloading sample video...");
      const testVideoUrl =
        "https://filesamples.com/samples/video/mp4/sample_640x360.mp4";
      const response = await axios.get(testVideoUrl, { responseType: "arraybuffer" });
      videoBuffer = Buffer.from(response.data);
    }

    await ig.publish.video({
      video: videoBuffer,
      coverFrame: 0,
      caption: "🚀 Test post successful! (session persisted)",
    });

    console.log("✅ Test video posted successfully!");
  } catch (err) {
    console.error("❌ Test post failed:", err.message);
  }
}

// ===============================
// Helpers
// ===============================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAllAccountsSequentially() {
  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    console.log(`⏳ Fetching videos for ${acc} (account ${i + 1}/${accounts.length})...`);
    await fetchVideos(acc);
    await sleep(10000); // avoid rate limits
  }
}

// ===============================
// Entry point
// ===============================
if (process.argv.includes("--test")) {
  testPost();
} else {
  fetchAllAccountsSequentially();
}

