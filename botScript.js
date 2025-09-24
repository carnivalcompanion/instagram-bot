// -------------------- Keep-alive server --------------------
const express = require('express');
const keepAliveApp = express();
const keepAlivePort = process.env.PORT || 3000;

keepAliveApp.get('/', (req, res) => {
  res.send('Node.js Bot is alive!');
});

keepAliveApp.listen(keepAlivePort, () => {
  console.log(`Keep-alive server running on port ${keepAlivePort}`);
});

// -------------------- Imports & Config --------------------
require("dotenv").config();
const { IgApiClient } = require("instagram-private-api");
const axios = require("axios");
const schedule = require("node-schedule");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

console.log("🚀 Script starting...");
console.log("Arguments:", process.argv);

const accounts = [
  "aircommittee3", "illusionsmas", "reignmasband", "shineymas",
  "Livcarnival", "fantasykarnival", "chocolatenationmas",
  "tropicalfusionmas", "carnivalsaintlucia", "jabjabofficial",
  "fuzionmas", "scorchmag", "yardmascarnival"
];

const username = process.env.IG_USERNAME;
const password = process.env.IG_PASSWORD;
const rapidApiKey = process.env.RAPIDAPI_KEY;

const localMediaDir = path.join(__dirname, "localMedia");
const placeholderPath = path.join(__dirname, "placeholder.jpg");
const sessionFile = "igSession.json";
const historyFile = "postedHistory.json";

if (!username || !password || !rapidApiKey) {
  console.error("❌ Missing env variables. Set IG_USERNAME, IG_PASSWORD, RAPIDAPI_KEY.");
  process.exit(1);
}

// -------------------- Instagram & History --------------------
const ig = new IgApiClient();
let postedHistory = [];

if (fs.existsSync(historyFile)) {
  try { postedHistory = JSON.parse(fs.readFileSync(historyFile, "utf8")); } 
  catch { postedHistory = []; }
}

// -------------------- Hashtags & Captions --------------------
const year = new Date().getFullYear();
const hashtagPool = [
  "#carnival","#soca","#caribbean","#trinidadcarnival","#carnaval","#fete",
  "#socamusic","#carnivalcostume","#mas","#jouvert","#caribbeancarnival","#cropover",
  "#playmas","#jabjab","#socavibes","#carnivalculture",`#carnival${year}`,`#soca${year}`
];

const captionTemplates = [
  "Having fun at the carnival! 🎉","Another great day for soca and music! 🥳",
  "Making memories that last forever! 🍹","Colors, feathers, and pure freedom! 🪶✨",
  "This is how we do carnival in the islands 🌴🔥","Soca therapy in full effect! 🎶💃",
  "Energy too high to calm down 🚀","Every beat of the drum tells a story 🥁❤️",
  "Mas is not just a festival, it's a lifestyle 🌟","From sunrise to sunset, pure carnival spirit 🌞🌙",
  "One love, one people, one carnival 💛💚❤️"
];

function getRandomHashtags(n = 5) {
  const shuffled = [...hashtagPool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n).join(" ");
}

function buildCaption(originalUser = null) {
  const randomText = captionTemplates[Math.floor(Math.random() * captionTemplates.length)];
  const hashtags = getRandomHashtags();
  const allTags = `${hashtags} #CarnivalCompanion`.split(" ").filter((tag,i,self)=>tag&&self.indexOf(tag)===i).join(" ");
  const credit = originalUser ? `\n\n📸 @${originalUser}` : "";
  return `${randomText}\n\n${allTags}${credit}`;
}

// -------------------- Utility Functions --------------------
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

function getRandomLocalMedia() {
  if (!fs.existsSync(localMediaDir)) return null;
  const files = fs.readdirSync(localMediaDir).filter(f=>/\.(jpg|jpeg|png|mp4)$/i.test(f));
  const usedFiles = new Set(postedHistory.filter(h=>h.source==="local").map(h=>h.id));
  const unused = files.filter(f=>!usedFiles.has(f));
  if (unused.length===0) {
    postedHistory = postedHistory.filter(h=>h.source!=="local");
    fs.writeFileSync(historyFile, JSON.stringify(postedHistory,null,2));
    return path.join(localMediaDir, files[Math.floor(Math.random()*files.length)]);
  }
  return path.join(localMediaDir, unused[Math.floor(Math.random()*unused.length)]);
}

function getVideoDuration(filePath){
  return new Promise((resolve,reject)=>{
    ffmpeg.ffprobe(filePath,(err,meta)=>err?reject(err):resolve(meta.format.duration));
  });
}

function extractVideoFrame(videoPath, outputPath){
  return new Promise((resolve,reject)=>{
    ffmpeg(videoPath).screenshots({
      timestamps:["00:00:01"],
      filename:path.basename(outputPath),
      folder:path.dirname(outputPath),
      size:"720x1280"
    }).on('end',()=>resolve(outputPath))
      .on('error',err=>reject(err));
  });
}

async function login(){
  ig.state.generateDevice(username);
  if (fs.existsSync(sessionFile)) {
    try{
      await ig.state.deserialize(JSON.parse(fs.readFileSync(sessionFile)));
      console.log("✅ Reused saved Instagram session");
      return;
    }catch{console.warn("⚠️ Failed to load session, logging in fresh...");}
  }
  console.log("🔑 Logging in fresh...");
  await ig.account.login(username,password);
  const serialized = await ig.state.serialize(); delete serialized.constants;
  fs.writeFileSync(sessionFile,JSON.stringify(serialized,null,2));
  console.log("🔒 New session saved");
}

async function refreshSession(){
  try{
    await ig.state.reset();
    await login();
    console.log("✅ Instagram session refreshed");
  }catch(err){console.error("❌ Failed to refresh session:",err.message);}
}

// -------------------- Fetch API Media --------------------
async function fetchMediaFromAccount(account, preferredType = null) {
  try{
    const normalized = account.toLowerCase().replace(/^\@/,"");
    const response = await axios.get(`https://instagram-social-api.p.rapidapi.com/v1/posts?username_or_id_or_url=${normalized}`,{
      headers: {"x-rapidapi-key":rapidApiKey,"x-rapidapi-host":"instagram-social-api.p.rapidapi.com"},
      timeout:20000
    });
    let items = Array.isArray(response.data?.data?.items)?response.data.data.items:
                Array.isArray(response.data?.items)?response.data.items:
                Array.isArray(response.data)?response.data:[];
    if(!items.length) return null;
    let post = items.find(p=>preferredType?p.media_type===preferredType:true)||items[0];
    let mediaUrl = post.media_type===2?post.video_versions?.[0]?.url||post.videos?.[0]?.url||post.carousel_media?.[0]?.video_versions?.[0]?.url:
                   post.media_type===1||post.media_type===8?post.image_versions2?.candidates?.[0]?.url||post.images?.standard_resolution?.url||post.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url:null;
    if(!mediaUrl) return null;
    return {post,mediaUrl};
  }catch(err){
    console.error(`❌ Error fetching @${account}:`,err.message);
    return null;
  }
}

// -------------------- Post Placeholder --------------------
async function postPlaceholder(){
  if(!fs.existsSync(placeholderPath)){console.error("❌ Placeholder missing"); return;}
  try{
    await login();
    await ig.publish.photo({file:fs.readFileSync(placeholderPath),caption:buildCaption()});
    console.log("✅ Placeholder posted");
  }catch(err){console.error("❌ Failed to post placeholder:",err.message);}
}

// -------------------- Post Media --------------------
async function postLocalMedia(localFile){
  let tempFramePath=null;
  try{
    await refreshSession();
    const buffer = fs.readFileSync(localFile);
    if(localFile.endsWith(".mp4")){
      const duration = await getVideoDuration(localFile);
      if(duration<3||duration>60){console.warn(`⚠️ Invalid video duration ${duration}s`); return false;}
      tempFramePath = path.join(__dirname,"temp_frame_local.jpg");
      await extractVideoFrame(localFile,tempFramePath);
      await ig.publish.video({video:buffer,coverImage:fs.readFileSync(tempFramePath),caption:buildCaption()});
      console.log("✅ Local video posted!");
    }else{
      await ig.publish.photo({file:buffer,caption:buildCaption()});
      console.log("✅ Local photo posted!");
    }
    postedHistory.push({id:path.basename(localFile),timestamp:Date.now(),username:"local",media_type:localFile.endsWith(".mp4")?2:1,success:true,source:"local"});
    if(postedHistory.length>1000) postedHistory=postedHistory.slice(-1000);
    fs.writeFileSync(historyFile,JSON.stringify(postedHistory,null,2));
    return true;
  }catch(err){console.error("❌ Error posting local media:",err.message); return false;}
  finally{if(tempFramePath&&fs.existsSync(tempFramePath)) fs.unlinkSync(tempFramePath);}
}

async function postApiMedia(post){
  let tempVideoPath=null,tempFramePath=null;
  try{
    await refreshSession();
    const account=post.user?.username;
    const fetched=await fetchMediaFromAccount(account,post.media_type);
    if(!fetched){console.log("⚠️ No valid API media"); return false;}
    const {post:fresh,mediaUrl}=fetched;
    if(fresh.media_type===2){
      const res=await axios.get(mediaUrl,{responseType:"arraybuffer",timeout:30000});
      tempVideoPath=path.join(__dirname,"temp_video.mp4"); fs.writeFileSync(tempVideoPath,res.data);
      const duration=await getVideoDuration(tempVideoPath);
      if(duration<3||duration>60){console.warn(`⚠️ Invalid API video ${duration}s`); return false;}
      tempFramePath=path.join(__dirname,"temp_frame.jpg");
      await extractVideoFrame(tempVideoPath,tempFramePath);
      await ig.publish.video({video:fs.readFileSync(tempVideoPath),coverImage:fs.readFileSync(tempFramePath),caption:buildCaption(account)});
      console.log("✅ API video posted!");
    }else{
      const res=await axios.get(mediaUrl,{responseType:"arraybuffer"});
      await ig.publish.photo({file:Buffer.from(res.data),caption:buildCaption(account)});
      console.log("✅ API image posted!");
    }
    postedHistory.push({id:fresh.id,timestamp:Date.now(),username:account,media_type:fresh.media_type,success:true,source:"api"});
    if(postedHistory.length>1000) postedHistory=postedHistory.slice(-1000);
    fs.writeFileSync(historyFile,JSON.stringify(postedHistory,null,2));
    return true;
  }catch(err){console.error("❌ Error posting API media:",err.message); return false;}
  finally{if(tempVideoPath&&fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath); if(tempFramePath&&fs.existsSync(tempFramePath)) fs.unlinkSync(tempFramePath);}
}

// -------------------- Scheduler --------------------
function getRandomTime(){
  const hour=6+Math.floor(Math.random()*16); const minute=Math.floor(Math.random()*60);
  const now=new Date(); const dt=new Date(now); dt.setHours(hour,minute,0,0);
  if(dt<now) dt.setDate(dt.getDate()+1); return dt;
}

function schedulePosts(allApiPosts){
  const totalPosts=Math.floor(Math.random()*(5-3+1))+3;
  console.log(`📅 Scheduling ${totalPosts} posts today`);
  for(let i=0;i<totalPosts;i++){
    const dt=getRandomTime();
    schedule.scheduleJob(dt,async ()=>{
      let localFile=getRandomLocalMedia();
      if(localFile){
        const success=await postLocalMedia(localFile);
        if(!success && allApiPosts.length>0) await postApiMedia(allApiPosts[Math.floor(Math.random()*allApiPosts.length)]);
        else if(!success) await postPlaceholder();
      }else if(allApiPosts.length>0){
        const success=await postApiMedia(allApiPosts[Math.floor(Math.random()*allApiPosts.length)]);
        if(!success) await postPlaceholder();
      }else{
        await postPlaceholder();
      }
    });
  }
}

// -------------------- Main Runner --------------------
(async ()=>{
  await login();

  // Fetch API posts once
  const allApiPosts=[];
  for(let acc of accounts){
    const posts=await fetchMediaFromAccount(acc);
    if(posts) allApiPosts.push(posts.post);
    await sleep(5000);
  }

  // Immediate post
  let localFile=getRandomLocalMedia();
  if(localFile){await postLocalMedia(localFile);}
  else if(allApiPosts.length>0){await postApiMedia(allApiPosts[0]);}
  else{await postPlaceholder();}

  // Schedule remaining posts
  schedulePosts(allApiPosts);
})();
