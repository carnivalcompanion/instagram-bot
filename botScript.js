[file name]: botScript.js
[file content begin]
// index.js - Final Render-ready Instagram scheduler + Drive scraper
// Features:
// - Instant startup post
// - Schedule 3-4 posts/day for 7 days with randomized peak times using Instagram's native scheduler
// - Attach generated caption (includes #carnivalcompanion and random hashtags)
// - Delete Drive file after it has been posted 2 times
// - Day 5: scrape up to 4 videos/account and upload to Drive
// - Session persistence + refresh

const express = require('express');
const keepAliveApp = express();
const keepAlivePort = process.env.PORT || 3000;

keepAliveApp.get('/', (req, res) => res.send('Node.js Bot with Google Drive integration is alive!'));
keepAliveApp.listen(keepAlivePort, () => console.log(`Keep-alive server running on port ${keepAlivePort}`));

require('dotenv').config();

const { IgApiClient } = require('instagram-private-api');
const { google } = require('googleapis');
const axios = require('axios');
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegPath);

// ---------- Logging ----------
function log(emoji, message, data = null) {
  const ts = new Date().toISOString();
  console.log(`${ts} ${emoji} ${message}`);
  if (data) console.log(`${ts} 📊 Data:`, JSON.stringify(data, null, 2));
}

// ---------- Globals ----------
let isLoggedIn = false;
let sessionRefreshInterval = null;

const accounts = [
  "aircommittee3","illusionsmas","reignmasband","shineymas","Livcarnival",
  "fantasykarnival","chocolatenationmas","tropicalfusionmas","carnivalsaintlucia",
  "jabjabofficial","fuzionmas","scorchmag","yardmascarnival"
];

const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || '1YLEwDRNzL3UmD9X35sEu4QSPrA50SXWS';
const placeholderPath = path.join(__dirname, 'placeholder.jpg');

if (!username || !password) {
  log('❌', 'Missing IG_USERNAME or IG_PASSWORD env var. Exiting.');
  process.exit(1);
}

const ig = new IgApiClient();

// ---------- Captioning ----------
const year = new Date().getFullYear();
const hashtagPool = [
  `#carnival`, `#soca`, `#caribbean`, `#trinidadcarnival`, `#carnaval`, `#fete`,
  `#socamusic`, `#carnivalcostume`, `#mas`, `#jouvert`, `#caribbeancarnival`,
  `#cropover`, `#playmas`, `#jabjab`, `#socavibes`, `#carnivalculture`,
  `#carnival${year}`, `#soca${year}`,
];

const captionTemplates = [
  `Having fun at the carnival! 🎉`, `Another great day for soca and music! 🥳`,
  `Making memories that last forever! 🍹`, `Colors, feathers, and pure freedom! 🪶✨`,
  `This is how we do carnival in the islands 🌴🔥`, `Soca therapy in full effect! 🎶💃`,
  `Energy too high to calm down 🚀`, `Every beat of the drum tells a story 🥁❤️`,
  `Mas is not just a festival, it's a lifestyle 🌟`, `From sunrise to sunset, pure carnival spirit 🌞🌙`,
  `When the riddim hits, there's no standing still 🎵⚡`, `One love, one people, one carnival 💛💚❤️`,
  `The road is ours today 🛣️👑`, `Jump, wave, repeat! 🔁🙌`, `Masqueraders bringing the heat 🔥💃`,
  `The Caribbean heartbeat never stops 💓🌊`, `Carnival in full effect! 🎭`
];

function getRandomHashtags(n = 5) {
  const shuffled = [...hashtagPool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n).join(' ');
}

function buildCaption(originalUser = null, extraText = '') {
  const txt = captionTemplates[Math.floor(Math.random() * captionTemplates.length)];
  const hashtags = getRandomHashtags();
  // ensure unique tags and include brand tag
  const allTags = `${hashtags} #CarnivalCompanion`.split(' ')
    .filter((t,i,a) => t && a.indexOf(t) === i).join(' ');
  const credit = originalUser ? `\n\n📸 @${originalUser}` : '';
  const extra = extraText ? `\n\n${extraText}` : '';
  return `${txt}\n\n${allTags}${credit}${extra}`;
}

// ---------- Persistence ----------
const sessionFile = 'igSession.json';
const historyFile = 'postedHistory.json';
const googleDriveHistoryFile = 'googleDriveHistory.json';
const cycleStateFile = 'cycleState.json';

let postedHistory = [];
let googleDriveHistory = {};
let cycleState = {
  currentCycle: 1,
  lastScrapeDate: null,
  lastScheduleDate: null,
  totalPostsScheduled: 0,
  totalVideosScraped: 0
};

if (fs.existsSync(historyFile)) {
  try { postedHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch (e) { postedHistory = []; }
}
if (fs.existsSync(googleDriveHistoryFile)) {
  try { googleDriveHistory = JSON.parse(fs.readFileSync(googleDriveHistoryFile, 'utf8')); } catch (e) { googleDriveHistory = {}; }
}
if (fs.existsSync(cycleStateFile)) {
  try { cycleState = JSON.parse(fs.readFileSync(cycleStateFile, 'utf8')); } catch (e) { cycleState = { currentCycle: 1, lastScrapeDate: null, lastScheduleDate: null, totalPostsScheduled: 0, totalVideosScraped: 0 }; }
}

function savePostedHistory() {
  try { fs.writeFileSync(historyFile, JSON.stringify(postedHistory, null, 2)); } catch (e) { log('❌', 'Failed to save posted history', e.message); }
}
function saveGoogleDriveHistory() {
  try { fs.writeFileSync(googleDriveHistoryFile, JSON.stringify(googleDriveHistory, null, 2)); } catch (e) { log('❌', 'Failed to save Drive history', e.message); }
}
function saveCycleState() {
  try { fs.writeFileSync(cycleStateFile, JSON.stringify(cycleState, null, 2)); } catch (e) { log('❌', 'Failed to save cycle state', e.message); }
}

function updateGoogleDriveRecord(fileId, fileName) {
  if (!googleDriveHistory[fileId]) {
    googleDriveHistory[fileId] = { postCount: 0, firstPosted: null, lastPosted: null, fileName };
  }
  const now = new Date().toISOString();
  googleDriveHistory[fileId].postCount++;
  googleDriveHistory[fileId].lastPosted = now;
  if (!googleDriveHistory[fileId].firstPosted) googleDriveHistory[fileId].firstPosted = now;
  saveGoogleDriveHistory();
}

// eligibility: <2 posts AND not posted in last 5 days
function isVideoEligibleForPosting(fileId) {
  const rec = googleDriveHistory[fileId];
  if (!rec) return true;
  if (rec.postCount >= 2) return false;
  if (!rec.lastPosted) return true;
  const last = new Date(rec.lastPosted);
  const fiveAgo = new Date(); fiveAgo.setDate(fiveAgo.getDate() - 5);
  return last < fiveAgo;
}

// ---------- Google Drive Helpers ----------
async function authenticateGoogleDrive(scopes = ['https://www.googleapis.com/auth/drive']) {
  try {
    let auth;
    if (process.env.GOOGLE_SERVICE_ACCOUNT) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
      auth = new google.auth.GoogleAuth({ credentials, scopes });
    } else {
      auth = new google.auth.GoogleAuth({ keyFile: path.join(__dirname, 'service-account-key.json'), scopes });
    }
    const drive = google.drive({ version: 'v3', auth });
    return drive;
  } catch (err) {
    log('❌', 'Google Drive auth failed:', err.message);
    return null;
  }
}

async function getVideosFromDrive(drive, folderId) {
  try {
    const q = `'${folderId}' in parents and (mimeType contains 'video/' or mimeType='application/octet-stream') and trashed=false`;
    const res = await drive.files.list({ q, fields: 'files(id,name,mimeType,size,createdTime)', orderBy: 'createdTime desc', pageSize: 1000 });
    return res.data.files || [];
  } catch (err) {
    log('❌', 'Drive list error:', err.message);
    return [];
  }
}

async function downloadDriveFile(drive, fileId, fileName) {
  try {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const safe = fileName.replace(/[^a-zA-Z0-9.]/g, '_');
    const out = path.join(tempDir, `drive_${Date.now()}_${safe}`);
    const resp = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    const writer = fs.createWriteStream(out);
    resp.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });
    return out;
  } catch (err) {
    log('❌', 'downloadDriveFile error:', err.message);
    return null;
  }
}

async function deleteFileFromDrive(drive, fileId, fileName = '') {
  try {
    await drive.files.delete({ fileId });
    log('🗑️', `Deleted from Drive: ${fileName || fileId}`);
    googleDriveHistory[fileId] = googleDriveHistory[fileId] || {};
    googleDriveHistory[fileId].deleted = true;
    saveGoogleDriveHistory();
    return true;
  } catch (err) {
    log('❌', `Drive delete failed for ${fileName || fileId}:`, err.message);
    return false;
  }
}

async function uploadFileToDrive(drive, folderId, localFilePath, fileName, mimeType = 'video/mp4') {
  try {
    const meta = { name: fileName, parents: [folderId] };
    const media = { mimeType, body: fs.createReadStream(localFilePath) };
    const res = await drive.files.create({ resource: meta, media, fields: 'id, name' });
    log('✅', `Uploaded to Drive: ${fileName}`, { id: res.data.id });
    return res.data;
  } catch (err) {
    log('❌', 'uploadFileToDrive error:', err.message);
    return null;
  }
}

// ---------- FFmpeg helpers ----------
function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => ffmpeg.ffprobe(filePath, (err, meta) => err ? reject(err) : resolve(meta.format.duration)));
}
function extractVideoFrame(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath).screenshots({ timestamps: ['00:00:01'], filename: path.basename(outputPath), folder: path.dirname(outputPath), size: '720x1280' })
      .on('end', () => resolve(outputPath)).on('error', err => reject(err));
  });
}

// ---------- Instagram Auth & Session ----------
async function login() {
  if (isLoggedIn) return true;
  log('🔑', 'Logging in to Instagram...');
  ig.state.generateDevice(username);

  if (fs.existsSync(sessionFile)) {
    try {
      const serialized = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      await ig.state.deserialize(serialized);
      log('✅', 'Reused IG session from file.');
      isLoggedIn = true;
      return true;
    } catch (e) {
      log('⚠️', 'Failed to deserialize session, will perform fresh login.');
    }
  }

  try {
    await ig.account.login(username, password);
    const serialized = await ig.state.serialize();
    delete serialized.constants;
    fs.writeFileSync(sessionFile, JSON.stringify(serialized, null, 2));
    log('✅', 'IG login successful and session saved.');
    isLoggedIn = true;
    return true;
  } catch (err) {
    log('❌', 'IG login failed:', err.message);
    return false;
  }
}

async function maintainSession() {
  try {
    if (!isLoggedIn) {
      return await login();
    }
    // lightweight check
    await ig.account.currentUser();
    return true;
  } catch (err) {
    log('⚠️', 'Session check failed, re-logging in...');
    isLoggedIn = false;
    return await login();
  }
}

// ---------- Caption scraping ----------
async function fetchRecentCaptionFromAccount(account) {
  if (!rapidApiKey) return null;
  try {
    const name = account.toLowerCase().replace(/^@/, '');
    const resp = await axios.get(`https://instagram-social-api.p.rapidapi.com/v1/posts?username_or_id_or_url=${name}`, {
      headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': 'instagram-social-api.p.rapidapi.com' },
      timeout: 20000
    });
    let items = [];
    if (Array.isArray(resp.data?.data?.items)) items = resp.data.data.items;
    else if (Array.isArray(resp.data?.items)) items = resp.data.items;
    else if (Array.isArray(resp.data)) items = resp.data;
    if (!items.length) return null;
    const recent = items[0];
    const caption = recent.caption?.text || recent.caption_text || recent.title || null;
    return caption ? { caption, username: account } : null;
  } catch (err) {
    return null;
  }
}

async function getInspiredCaption() {
  const shuffled = [...accounts].sort(() => 0.5 - Math.random());
  const check = shuffled.slice(0, 3);
  for (const a of check) {
    const res = await fetchRecentCaptionFromAccount(a);
    if (res && res.caption) {
      const short = res.caption.length > 2200 ? res.caption.slice(0, 2190) + '…' : res.caption;
      return { caption: short, username: res.username };
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return null;
}

// ---------- Posting / Scheduling ----------

// immediate publish (used for startup)
async function publishNow(localVideoPath, coverPath, caption) {
  await maintainSession();
  const publish = await ig.publish.video({ 
    video: fs.readFileSync(localVideoPath), 
    coverImage: fs.readFileSync(coverPath), 
    caption 
  });
  return publish;
}

// schedule publish using Instagram's native scheduler for professional accounts
async function publishScheduled(localVideoPath, coverPath, caption, scheduleDate) {
  await maintainSession();
  
  // Convert scheduleDate to Unix timestamp in seconds (Instagram API requirement)
  const publishTime = Math.floor(scheduleDate.getTime() / 1000);
  
  const publish = await ig.publish.video({
    video: fs.readFileSync(localVideoPath),
    coverImage: fs.readFileSync(coverPath),
    caption,
    // Instagram's native scheduling for professional accounts
    scheduled_publish_time: publishTime
  });
  
  log('✅', `Successfully scheduled post for ${scheduleDate.toISOString()} using Instagram's native scheduler`);
  return publish;
}

async function postVideoFile(drive, driveFile, scheduleDate = null) {
  let localPath = null;
  let coverPath = null;
  try {
    localPath = await downloadDriveFile(drive, driveFile.id, driveFile.name);
    if (!localPath) { log('❌', 'Failed to download file'); return false; }

    // duration check (Instagram limit: 180 seconds / 3 minutes)
    try {
      const dur = await getVideoDuration(localPath);
      if (dur < 3 || dur > 181.5) { 
        log('⚠️', `Video duration ${dur}s outside 3-181.5s range — skipping`); 
        try { fs.unlinkSync(localPath); } catch (_) {}
        return false; 
      }
      log('✅', `Video duration: ${dur}s (within acceptable range)`);
    } catch (e) { 
      log('⚠️', 'Could not probe duration — continuing'); 
    }

    const inspired = await getInspiredCaption();
    const caption = inspired ? buildCaption(inspired.username, inspired.caption) : buildCaption();

    // cover extraction
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    coverPath = path.join(tempDir, `cover_${Date.now()}.jpg`);
    try { 
      await extractVideoFrame(localPath, coverPath); 
    } catch (e) {
      // fallback
      if (fs.existsSync(placeholderPath)) {
        fs.copyFileSync(placeholderPath, coverPath);
      } else {
        // Create minimal placeholder
        const minimalJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8U/9k=', 'base64');
        fs.writeFileSync(coverPath, minimalJpeg);
      }
    }

    let publishResult;
    if (scheduleDate) {
      log('🕒', `Scheduling ${driveFile.name} at ${scheduleDate.toISOString()} using Instagram's native scheduler`);
      publishResult = await publishScheduled(localPath, coverPath, caption, scheduleDate);
    } else {
      log('⚡', `Publishing now: ${driveFile.name}`);
      publishResult = await publishNow(localPath, coverPath, caption);
    }

    const mediaId = publishResult?.media?.id || `ig_${Date.now()}`;
    // update history
    updateGoogleDriveRecord(driveFile.id, driveFile.name);
    updatePostedLists(mediaId, driveFile.id, driveFile.name, caption, scheduleDate);

    // after update, check deletion condition
    const rec = googleDriveHistory[driveFile.id];
    if (rec && rec.postCount >= 2) {
      log('🧾', `File ${driveFile.name} reached ${rec.postCount} posts — deleting from Drive`);
      await deleteFileFromDrive(drive, driveFile.id, driveFile.name);
    }

    log('✅', `Posted/scheduled successfully: ${driveFile.name}`);
    return true;
  } catch (err) {
    log('❌', 'postVideoFile error:', err.message);
    // Log specific scheduling errors
    if (err.message.includes('scheduled_publish_time')) {
      log('⚠️', 'Scheduling failed. This might be because:');
      log('⚠️', '- Your account is not a professional account');
      log('⚠️', '- The scheduled time is too far in the future (max 75 days)');
      log('⚠️', '- The scheduled time is in the past');
    }
    return false;
  } finally {
    // cleanup local files
    try { if (localPath && fs.existsSync(localPath)) fs.unlinkSync(localPath); } catch (_) {}
    try { if (coverPath && fs.existsSync(coverPath)) fs.unlinkSync(coverPath); } catch (_) {}
  }
}

function updatePostedLists(mediaId, driveFileId, driveFileName, caption, scheduledFor = null) {
  const now = new Date().toISOString();
  postedHistory.push({ 
    id: mediaId, 
    driveFileId, 
    driveFileName, 
    postedAt: now, 
    scheduledFor: scheduledFor ? scheduledFor.toISOString() : null, 
    caption: caption.slice(0,200) 
  });
  if (postedHistory.length > 1000) postedHistory = postedHistory.slice(-1000);
  savePostedHistory();
}

// choose a random eligible video from Drive
async function getRandomEligibleDriveVideo(drive) {
  const vids = await getVideosFromDrive(drive, driveFolderId);
  if (!vids.length) return null;
  const candidates = vids.filter(v => isVideoEligibleForPosting(v.id));
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ---------- Scraping logic (Day 5) ----------
async function downloadUploadVideoToDrive(drive, videoUrl, accountName, idx) {
  try {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const ts = Date.now();
    const fname = `scraped_${accountName}_${idx}_${ts}.mp4`;
    const filepath = path.join(tempDir, fname);

    const resp = await axios({ 
      method: 'GET', 
      url: videoUrl, 
      responseType: 'stream', 
      timeout: 45000, 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const writer = fs.createWriteStream(filepath);
    resp.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });

    const stats = fs.statSync(filepath);
    if (stats.size < 100000) { 
      log('⚠️', `File too small (${stats.size} bytes), likely invalid`);
      fs.unlinkSync(filepath); 
      return false; 
    }

    const uploaded = await uploadFileToDrive(drive, driveFolderId, filepath, fname, 'video/mp4');
    try { fs.unlinkSync(filepath); } catch (e) {}

    if (uploaded && uploaded.id) {
      // Initialize history for new file
      googleDriveHistory[uploaded.id] = { 
        postCount: 0, 
        firstPosted: null, 
        lastPosted: null, 
        fileName: uploaded.name,
        scrapedFrom: accountName,
        scrapedAt: new Date().toISOString()
      };
      saveGoogleDriveHistory();
      cycleState.totalVideosScraped++;
      saveCycleState();
      return true;
    }
    return false;
  } catch (err) {
    log('❌', `downloadUploadVideoToDrive error for ${accountName}:`, err.message);
    return false;
  }
}

async function scrapeDayFive() {
  if (!rapidApiKey) { log('⚠️', 'No RAPIDAPI_KEY set — skipping scraping'); return 0; }
  const drive = await authenticateGoogleDrive();
  if (!drive) { log('⚠️', 'Drive unavailable; skipping scraping'); return 0; }

  log('🔎', 'Starting Day 5 scraping - 4 videos per account');
  let total = 0;
  
  for (const account of accounts) {
    try {
      const name = account.toLowerCase().replace(/^@/, '');
      log('🔍', `Scraping @${name}`);
      const resp = await axios.get(`https://instagram-social-api.p.rapidapi.com/v1/posts?username_or_id_or_url=${name}`, {
        headers: { 'x-rapidapi-key': rapidApiKey, 'x-rapidapi-host': 'instagram-social-api.p.rapidapi.com' }, 
        timeout: 25000
      });

      let items = [];
      if (Array.isArray(resp.data?.data?.items)) items = resp.data.data.items;
      else if (Array.isArray(resp.data?.items)) items = resp.data.items;
      else if (Array.isArray(resp.data)) items = resp.data;
      
      if (!items.length) { 
        log('⚠️', `No posts for ${account}`); 
        continue; 
      }

      let found = 0;
      for (const it of items) {
        if (found >= 4) break;
        
        // Look for video content
        const videoUrl = it.video_versions?.[0]?.url || it.media_url || it.video_url || null;
        if (!videoUrl) continue;
        
        log('📥', `Downloading video ${found + 1}/4 from @${name}`);
        const ok = await downloadUploadVideoToDrive(drive, videoUrl, name, found + 1);
        if (ok) { 
          found++; 
          total++; 
          log('✅', `Uploaded video ${found}/4 from @${name}`);
        }
        
        await new Promise(r => setTimeout(r, 4000)); // 4 second delay between downloads
      }
      
      log('📊', `@${name} -> uploaded ${found}/4 videos`);
      await new Promise(r => setTimeout(r, 6000)); // 6 second delay between accounts
      
    } catch (err) {
      log('❌', `Scrape error for ${account}:`, err.message);
      await new Promise(r => setTimeout(r, 8000)); // Longer delay on error
    }
  }
  
  cycleState.lastScrapeDate = new Date().toISOString();
  saveCycleState();
  
  log('✅', `Scraping complete: uploaded ${total} new videos to Drive`);
  return total;
}

// ---------- Scheduling logic ----------
const peakSlots = [
  { hour: 9, minute: 0 }, { hour: 11, minute: 0 }, { hour: 13, minute: 0 },
  { hour: 15, minute: 30 }, { hour: 17, minute: 0 }, { hour: 19, minute: 0 },
  { hour: 20, minute: 30 }, { hour: 22, minute: 0 }
];

function pickRandomSlots(n = 3) {
  const shuffled = [...peakSlots].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n);
}

// schedule 7 days: pick 3-4 posts/day and schedule them using Instagram's native scheduler
async function scheduleSevenDays() {
  log('📅', 'Scheduling posts for next 7 days using Instagram native scheduler...');
  const drive = await authenticateGoogleDrive();
  if (!drive) { log('⚠️', 'Drive auth failed — cannot schedule'); return 0; }
  
  let scheduled = 0;
  let attempted = 0;

  const now = new Date();
  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
    const postsPerDay = Math.floor(Math.random() * 2) + 3; // 3 or 4
    const slots = pickRandomSlots(postsPerDay);
    
    log(`📋`, `Day ${dayOffset}: ${postsPerDay} posts for ${date.toDateString()}`);
    
    for (const slot of slots) {
      const scheduleDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), slot.hour, slot.minute, 0);
      if (scheduleDate <= new Date()) continue; // skip past times
      
      attempted++;
      const candidate = await getRandomEligibleDriveVideo(drive);
      if (!candidate) {
        log('📭', 'No eligible candidate to schedule for', scheduleDate.toLocaleString());
        continue;
      }
      
      const ok = await postVideoFile(drive, candidate, scheduleDate);
      if (ok) scheduled++;
      
      await new Promise(r => setTimeout(r, 5000)); // 5 second delay between scheduling requests
    }
  }

  cycleState.lastScheduleDate = new Date().toISOString();
  cycleState.totalPostsScheduled += scheduled;
  saveCycleState();

  log('✅', `Scheduled ${scheduled}/${attempted} posts for next 7 days using Instagram's native scheduler`);
  return scheduled;
}

// ---------- Cycle control ----------
async function startSevenDayCycle() {
  try {
    log('🔄', `=== STARTING CYCLE ${cycleState.currentCycle} ===`);
    
    // Instant startup post (attempt once)
    log('⚡', 'Attempting instant startup post...');
    try {
      const drive = await authenticateGoogleDrive();
      if (drive) {
        const instantCandidate = await getRandomEligibleDriveVideo(drive);
        if (instantCandidate) {
          await postVideoFile(drive, instantCandidate, null); // publishNow
        } else {
          log('⚠️', 'No eligible video for instant post');
        }
      } else {
        log('⚠️', 'Drive unavailable for instant post');
      }
    } catch (e) { 
      log('❌', 'Instant post failure:', e.message); 
    }

    // Schedule Day 5 scraping (4 days from now at 10:00)
    const day5 = new Date(); 
    day5.setDate(day5.getDate() + 4); 
    day5.setHours(10, 0, 0, 0);
    
    schedule.scheduleJob(day5, async () => {
      log('5️⃣', 'Day 5: Starting content scraping...');
      await maintainSession();
      await scrapeDayFive();
    });

    // Schedule Day 8 next cycle (7 days from now at 08:00)
    const day8 = new Date(); 
    day8.setDate(day8.getDate() + 7); 
    day8.setHours(8, 0, 0, 0);
    
    schedule.scheduleJob(day8, async () => {
      log('🔄', 'Day 8: Starting next 7-day cycle');
      cycleState.currentCycle++;
      saveCycleState();
      await startSevenDayCycle();
    });

    // Then schedule the next 7 days using Instagram's native scheduler
    await scheduleSevenDays();
    
    log('✅', `Cycle ${cycleState.currentCycle} started successfully`);
    log('📅', `- Day 5 scraping: ${day5.toLocaleString()}`);
    log('📅', `- Next cycle: ${day8.toLocaleString()}`);

  } catch (err) {
    log('❌', 'startSevenDayCycle error:', err.message);
  }
}

// ---------- Main startup ----------
(async () => {
  try {
    // ensure temp directory
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const ok = await login();
    if (!ok) throw new Error('IG login failed');

    // session refresh every 6 hours to keep session active
    sessionRefreshInterval = setInterval(async () => {
      await maintainSession();
    }, 6 * 60 * 60 * 1000);

    // Start cycle
    await startSevenDayCycle();

    log('🏁', 'Bot is initialized and running.');
    log('💡', `Current Cycle: ${cycleState.currentCycle}`);
    log('📊', `Total videos in pool: ${Object.keys(googleDriveHistory).length}`);

  } catch (err) {
    log('❌', 'Startup fatal error:', err.message);
    if (sessionRefreshInterval) clearInterval(sessionRefreshInterval);
    process.exit(1);
  }
})();

// ---------- graceful shutdown ----------
process.on('SIGINT', () => { 
  log('🛑', 'SIGINT received, shutting down'); 
  if (sessionRefreshInterval) clearInterval(sessionRefreshInterval); 
  process.exit(0); 
});

process.on('SIGTERM', () => { 
  log('🛑', 'SIGTERM received, shutting down'); 
  if (sessionRefreshInterval) clearInterval(sessionRefreshInterval); 
  process.exit(0); 
});
[file content end]