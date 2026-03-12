const express = require("express");
const http = require("http");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 5000;

const CONFIG = {
  baseUrl: "http://www.timesms.net",
  username: "Junaidaliniz",
  password: "Junaidaliniz",
  userAgent: "Mozilla/5.0 (Linux; Android 13; V2040 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.7632.79 Mobile Safari/537.36"
};

let cookies = [];
let isLoggedIn = false;
let lastSeenSmsIds = new Set();

// ✅ Aaj ki date dynamic
function getTodayDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: "Invalid JSON from server", rawPreview: text.substring(0, 300) };
  }
}

function makeRequest(method, path, data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    let cleanPath = path.startsWith("/") ? path : "/" + path;
    const fullUrl = CONFIG.baseUrl + cleanPath;

    console.log(`[REQ] ${method} ${fullUrl}`);

    const headers = {
      "User-Agent": CONFIG.userAgent,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-PK,en;q=0.9",
      "Cookie": cookies.join("; "),
      ...extraHeaders
    };

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
      headers["Origin"] = CONFIG.baseUrl;
    }

    const req = http.request(fullUrl, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const part = c.split(";")[0];
          if (!cookies.includes(part)) cookies.push(part);
        });
      }
      let chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        if (res.headers["content-encoding"] === "gzip") {
          try { buffer = zlib.gunzipSync(buffer); } catch {}
        }
        resolve(buffer.toString());
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  cookies = [];
  isLoggedIn = false;

  const page = await makeRequest("GET", "/login");
  const match = page.match(/What is (\d+)\s*\+\s*(\d+)\s*=?\s*\??/i);
  const capt = match ? Number(match[1]) + Number(match[2]) : 10;

  const form = querystring.stringify({
    username: CONFIG.username,
    password: CONFIG.password,
    capt
  });

  await makeRequest("POST", "/signin", form, {
    Referer: `${CONFIG.baseUrl}/login`
  });

  const test = await makeRequest("GET", "/agent/");
  if (test.includes("Please sign in") || test.includes("login")) {
    throw new Error("Login failed");
  }

  isLoggedIn = true;
  console.log("[LOGIN] Success");
}

function fixNumbers(data) {
  if (!data.aaData) return data;
  data.aaData = data.aaData.map(row => [
    row[1] || "",
    "",
    row[3] || "",
    "Weekly",
    (row[4] || "").replace(/<[^>]+>/g, "").trim(),
    (row[7] || "").replace(/<[^>]+>/g, "").trim()
  ]);
  return data;
}

function fixSMS(data) {
  if (!data.aaData) return data;
  data.aaData = data.aaData
    .map(row => {
      let message = (row[5] || "").replace(/legendhacker/gi, "").trim();
      if (!message) return null;
      return [
        row[0] || "",
        row[1] || "",
        row[2] || "",
        row[3] || "",
        message,
        "$",
        row[7] || 0
      ];
    })
    .filter(Boolean);
  return data;
}

async function getNumbers() {
  if (!isLoggedIn) await login();

  const params = querystring.stringify({
    frange: "", fclient: "",
    sEcho: "2", iDisplayStart: "0", iDisplayLength: "-1"
  });

  const data = await makeRequest("GET", `/agent/res/data_smsnumbers.php?${params}`, null, {
    Referer: `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixNumbers(safeJSON(data));
}

async function getSMS() {
  await login();

  // ✅ Sirf aaj ki date (dynamic)
  const today = getTodayDate();
  console.log("[SMS] Daily fetch for:", today);

  const params = [
    `fdate1=${encodeURIComponent(today + " 00:00:00")}`,
    `fdate2=${encodeURIComponent(today + " 23:59:59")}`,
    `frange=`, `fclient=`, `fnum=`, `fcli=`,
    `fg=0`,
    `iDisplayLength=2000`
  ].join("&");

  const urlPath = `/agent/res/data_smscdr.php?${params}`;

  try {
    await makeRequest("GET", "/agent/SMSCDRReports", null, {
      Referer: `${CONFIG.baseUrl}/agent/`
    });
  } catch (err) {
    console.warn("[SMS] SMSCDRReports load failed:", err.message);
  }

  let data = await makeRequest("GET", urlPath, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01"
  });

  if (data.includes("Direct Script Access") || data.includes("Please sign in") || data.includes("login")) {
    console.log("[SMS] Blocked - retrying...");
    await login();
    await makeRequest("GET", "/agent/SMSCDRReports");
    data = await makeRequest("GET", urlPath, null, {
      Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
      "X-Requested-With": "XMLHttpRequest"
    });
  }

  const json = safeJSON(data);
  const result = fixSMS(json);
  console.log("[SMS] Messages today:", result.aaData?.length || 0);
  return result;
}

// ✅ Sirf naye SMS filter karna
async function getNewSMS() {
  const result = await getSMS();
  if (!result.aaData) return result;

  const allRows = result.aaData;
  const newRows = allRows.filter(row => !lastSeenSmsIds.has(row[0]));
  allRows.forEach(row => lastSeenSmsIds.add(row[0]));

  const today = getTodayDate();
  return { newCount: newRows.length, newSms: newRows, date: today };
}

app.get("/api", async (req, res) => {
  const { type } = req.query;

  if (!type) return res.json({ error: "Use ?type=numbers, ?type=sms, or ?type=new-sms" });

  try {
    if (type === "numbers") return res.json(await getNumbers());
    if (type === "sms")     return res.json(await getSMS());
    if (type === "new-sms") return res.json(await getNewSMS());
    res.json({ error: "Invalid type" });
  } catch (err) {
    console.error("[ERROR]", err.message);
    res.json({ error: err.message || "Failed" });
  }
});

// ✅ Seen IDs reset
app.post("/reset-seen", (req, res) => {
  lastSeenSmsIds.clear();
  res.json({ success: true, message: "Seen SMS IDs cleared." });
});

app.listen(PORT, () => {
  console.log(`TimeSMS Server running on port ${PORT}`);
});
