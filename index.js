const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const junaid = require("./api/junaid");
const ayan = require("./api/ayan");   // Naya add kiya
const ahmad = require("./api/ahmad"); // Naya add kiya

// --- ROUTES ---
app.use("/api/junaid", junaid);
app.use("/api/ayan", ayan);     // Naya route set kiya
app.use("/api/ahmad", ahmad);   // Naya route set kiya

// --- HEALTH CHECK ---
app.get("/", (req, res) => res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
