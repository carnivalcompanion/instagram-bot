// server.js
require("dotenv").config();
const express = require("express");
const { fetchAllAccountsSequentially } = require("./botScript");

const app = express();

// Basic health check route
app.get("/status", (req, res) => {
  res.json({
    status: "Bot is alive ✅",
    timestamp: new Date().toISOString(),
  });
});

// Use port 10000 for backend to avoid clashing with React frontend
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Backend server running on port ${PORT}`);
  console.log("🤖 Starting Instagram bot...");
  
  // Start the bot
  fetchAllAccountsSequentially().catch(err => {
    console.error("❌ Bot failed to start:", err);
  });
});