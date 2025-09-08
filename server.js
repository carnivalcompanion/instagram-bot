const express = require("express");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

// Root route
app.get("/", (req, res) => {
  res.send("🚀 Instagram Bot is running!");
});

// Keep the bot alive
setInterval(() => {
  console.log("⏱️ Bot is alive ping at", new Date().toISOString());
}, 5 * 60 * 1000);

// Start the bot script automatically
exec("node botScript.js", (err, stdout, stderr) => {
  if (err) {
    console.error("❌ Error running bot:", err);
    return;
  }
  console.log(stdout);
  if (stderr) console.error(stderr);
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// 🌍 Self-ping to keep Render free tier alive
const axios = require("axios");

setInterval(() => {
  axios
    .get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME || "instagram-bot-ua6x.onrender.com"}`)
    .then(() => console.log("🔄 Self-ping successful"))
    .catch((err) => console.error("⚠️ Self-ping failed:", err.message));
}, 14 * 60 * 1000); // every 14 minutes


