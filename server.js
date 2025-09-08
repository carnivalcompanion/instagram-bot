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
