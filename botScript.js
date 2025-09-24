import express from 'express';
import 'dotenv/config';
import { IgApiClient } from 'instagram-private-api';
import axios from 'axios';
import schedule from 'node-schedule';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

const ig = new IgApiClient();
ig.state.generateDevice(process.env.IG_USERNAME);

// Helpers
const randomDelay = (min = 30, max = 180) => Math.floor(Math.random() * (max - min + 1) + min) * 1000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getLocalMedia = (folder = './localMedia') => {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(f => f.endsWith('.mp4'));
};

const convertVideoIfNeeded = (filePath) => {
  return new Promise((resolve, reject) => {
    const tempPath = path.join('./', 'converted.mp4');
    ffmpeg(filePath)
      .outputOptions('-movflags faststart')
      .save(tempPath)
      .on('end', () => resolve(tempPath))
      .on('error', reject);
  });
};

const postVideo = async (videoPath, caption = '') => {
  try {
    let uploadPath = videoPath;
    if (!videoPath.endsWith('.mp4')) {
      uploadPath = await convertVideoIfNeeded(videoPath);
    }
    const videoBuffer = fs.readFileSync(uploadPath);
    await ig.publish.video({ video: videoBuffer, caption });
    console.log(`✅ Posted video: ${videoPath}`);
    if (uploadPath !== videoPath) fs.unlinkSync(uploadPath);
  } catch (err) {
    console.error('❌ Failed to post video:', err.message);
  }
};

const downloadVideo = async (url, dest) => {
  const writer = fs.createWriteStream(dest);
  const response = await axios.get(url, { responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
};

const postFromAPI = async (url, caption = '') => {
  const tmpPath = path.join('./', 'tempVideo.mp4');
  try {
    await downloadVideo(url, tmpPath);
    await postVideo(tmpPath, caption);
    fs.unlinkSync(tmpPath);
    return true;
  } catch (err) {
    console.error('❌ Failed API video:', err.message);
    return false;
  }
};

const postPlaceholder = async () => {
  const placeholder = './placeholder.jpg';
  try {
    const imageBuffer = fs.readFileSync(placeholder);
    await ig.publish.photo({ file: imageBuffer, caption: '📌 Placeholder post' });
    console.log('✅ Posted placeholder image.');
  } catch (err) {
    console.error('❌ Failed placeholder post:', err.message);
  }
};

// Main posting logic
const makePost = async () => {
  let posted = false;
  const localVideos = getLocalMedia();

  // 1️⃣ Try local media first
  if (localVideos.length > 0) {
    const video = localVideos[Math.floor(Math.random() * localVideos.length)];
    await postVideo(`./localMedia/${video}`, '🌟 Carnival vibes!');
    posted = true;
  }

  // 2️⃣ Try API if no local posted
  if (!posted) {
    const apiVideos = [
      { url: 'https://example.com/video1.mp4', caption: '🎉 From API' },
      { url: 'https://example.com/video2.mp4', caption: '🎊 From API' },
    ];

    for (let vid of apiVideos) {
      const success = await postFromAPI(vid.url, vid.caption);
      if (success) {
        posted = true;
        break;
      }
    }
  }

  // 3️⃣ Fallback placeholder
  if (!posted) await postPlaceholder();
};

// Schedule human-like posts
const schedulePosts = () => {
  const postsPerDay = 3;
  for (let i = 0; i < postsPerDay; i++) {
    const hour = 9 + Math.floor(Math.random() * 10); // 9AM–6PM
    const minute = Math.floor(Math.random() * 60);
    schedule.scheduleJob({ hour, minute }, async () => {
      console.log(`🕒 Scheduled post at ${hour}:${minute}`);
      await makePost();
      const delay = randomDelay();
      console.log(`⏳ Next post delay: ${Math.floor(delay / 1000)}s`);
      await wait(delay);
    });
  }
};

// Instagram login
const login = async () => {
  try {
    await ig.account.login(process.env.IG_USERNAME, process.env.IG_PASSWORD);
    console.log('🔐 Logged in to Instagram.');
  } catch (err) {
    console.error('❌ Login failed:', err.message);
  }
};

// Start server & bot
app.listen(PORT, async () => {
  console.log(`🌐 Server running on port ${PORT}`);
  await login();

  console.log('🚀 Immediate startup post...');
  await makePost();

  schedulePosts();
});
