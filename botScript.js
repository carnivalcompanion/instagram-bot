// botScript.js
import express from 'express';
import 'dotenv/config';
import { IgApiClient } from 'instagram-private-api';
import axios from 'axios';
import schedule from 'node-schedule';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { fileURLToPath } from 'url';

ffmpeg.setFfmpegPath(ffmpegPath);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME);

const SESSION_FILE_PATH = path.join(__dirname, 'igSession.json');
const TEMP_DIR = path.join(__dirname, 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function randomDelay(minSec, maxSec) {
  return Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
}

async function humanDelay(minSec = 2, maxSec = 6) {
  const delay = randomDelay(minSec, maxSec);
  console.log(`⏳ Human-like delay: ${delay / 1000}s`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function loginInstagram() {
  try {
    if (fs.existsSync(SESSION_FILE_PATH)) {
      const savedSession = JSON.parse(fs.readFileSync(SESSION_FILE_PATH, 'utf-8'));
      await ig.state.deserialize(savedSession);
      console.log('✅ Session loaded successfully');
    } else {
      console.log('🔐 Forced fresh login initiated...');
      await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
      fs.writeFileSync(SESSION_FILE_PATH, JSON.stringify(await ig.state.serialize()));
      console.log('✅ Fresh login complete and session saved');
    }
  } catch (err) {
    console.error('❌ Instagram login error:', err);
  }
}

async function downloadMedia(url, dest) {
  try {
    const writer = fs.createWriteStream(dest);
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (err) {
    console.error('❌ Failed to download media:', err);
    throw err;
  }
}

async function processVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions('-c:v libx264', '-pix_fmt yuv420p', '-preset veryfast', '-movflags +faststart')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

async function postToInstagram({ videoPath, imagePath, caption }) {
  try {
    await humanDelay(3, 8); // small human-like pause before posting
    if (videoPath) {
      await ig.publish.video({
        video: fs.readFileSync(videoPath),
        caption,
      });
      console.log('📤 Video posted successfully');
    } else if (imagePath) {
      await ig.publish.photo({
        file: fs.readFileSync(imagePath),
        caption,
      });
      console.log('📤 Image posted successfully');
    } else {
      console.log('⚠️ No media available to post');
    }
  } catch (err) {
    console.error('❌ Failed to post media:', err);
  }
}

async function makePost() {
  console.log('🚀 Making a scheduled post...');
  let posted = false;

  // 1️⃣ Try local media first
  const localVideos = fs.readdirSync(path.join(__dirname, 'localMedia')).filter(f => f.endsWith('.mp4'));
  if (localVideos.length) {
    const videoFile = path.join(__dirname, 'localMedia', localVideos[0]);
    const processedFile = path.join(TEMP_DIR, 'processed.mp4');
    try {
      await processVideo(videoFile, processedFile);
      await postToInstagram({ videoPath: processedFile, caption: 'Your caption here' });
      posted = true;
    } catch (err) {
      console.error('❌ Local video failed:', err);
    }
  }

  // 2️⃣ Try API videos if local failed
  if (!posted) {
    try {
      const apiVideoUrl = 'https://example.com/apiVideo.mp4'; // Replace with real API
      const downloadPath = path.join(TEMP_DIR, 'apiVideo.mp4');
      await downloadMedia(apiVideoUrl, downloadPath);
      const processedFile = path.join(TEMP_DIR, 'processedApi.mp4');
      await processVideo(downloadPath, processedFile);
      await postToInstagram({ videoPath: processedFile, caption: 'API video post' });
      posted = true;
    } catch (err) {
      console.error('❌ API video failed:', err);
    }
  }

  // 3️⃣ Fallback placeholder image
  if (!posted) {
    const placeholderImage = path.join(__dirname, 'placeholder.jpg');
    await postToInstagram({ imagePath: placeholderImage, caption: 'Placeholder post' });
  }
}

async function startScheduler() {
  // Schedule 1–3 posts per day with random times
  const postsPerDay = Math.floor(Math.random() * 3) + 1; // 1 to 3 posts
  console.log(`📅 Today’s plan: ${postsPerDay} post(s)`);
  for (let i = 0; i < postsPerDay; i++) {
    const hour = Math.floor(Math.random() * 12) + 8; // 8 AM - 8 PM
    const minute = Math.floor(Math.random() * 60);
    schedule.scheduleJob({ hour, minute }, async () => {
      console.log(`⏰ Scheduled post triggered at ${hour}:${minute}`);
      await makePost();
    });
  }
}

app.get('/', (req, res) => res.send('Instagram Bot Running 🚀'));

app.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  await loginInstagram();
  await makePost(); // immediate post on startup
  startScheduler();
});
