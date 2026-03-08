const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// --- IMPORT ALL PANELS ---
const junaid = require("./api/junaid");
const ayan = require("./api/ayan");   // <--- Variable name sahi kar diya
const ahmad = require("./api/ahmad"); // <--- Ahmad bhi add kar diya

// --- ROUTES ---
app.use("/api/junaid", junaid);
app.use("/api/ayan", ayan);     // <--- Ab ye variable work karega
app.use("/api/ahmad", ahmad);   // <--- Ahmad ka route bhi ready hai

// --- HEALTH CHECK ---
app.get("/", (req,res)=> res.send("API RUNNING ✅"));

// --- START SERVER ---
app.listen(PORT, "0.0.0.0", ()=>console.log(`🚀 Server running on port ${PORT}`));
