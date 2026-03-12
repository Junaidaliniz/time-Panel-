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
let seenIds = new Set();

function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function makeRequest(method, path, data = null, extra = {}) {
  return new Promise((resolve, reject) => {
    const url = CONFIG.baseUrl + (path.startsWith("/") ? path : "/" + path);
    const headers = {
      "User-Agent": CONFIG.userAgent,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-PK,en;q=0.9",
      "Cookie": cookies.join("; "),
      ...extra
    };
    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
      headers["Origin"] = CONFIG.baseUrl;
    }
    const req = http.request(url, { method, headers }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const part = c.split(";")[0];
          if (!cookies.includes(part)) cookies.push(part);
        });
      }
      const chunks = [];
      res.on("data", d => chunks.push(d));
      res.on("end", () => {
        let buf = Buffer.concat(chunks);
        if (res.headers["content-encoding"] === "gzip") {
          try { buf = zlib.gunzipSync(buf); } catch {}
        }
        resolve(buf.toString());
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  cookies = [];
  const page = await makeRequest("GET", "/login");
  const m = page.match(/What is (\d+)\s*\+\s*(\d+)/i);
  const capt = m ? Number(m[1]) + Number(m[2]) : 10;
  const form = querystring.stringify({ username: CONFIG.username, password: CONFIG.password, capt });
  await makeRequest("POST", "/signin", form, { Referer: `${CONFIG.baseUrl}/login` });
  console.log("[LOGIN] Done");
}

// ✅ Sirf aaj ki nayi SMS
async function getDailyNewSMS() {
  await login();

  const urlPath = `/agent/res/data_smscdr.php?fdate1=${encodeURIComponent("2020-01-01 00:00:00")}&fdate2=${encodeURIComponent("2099-12-31 23:59:59")}&frange=&fclient=&fnum=&fcli=&fg=0&iDisplayLength=5000`;

  try { await makeRequest("GET", "/agent/SMSCDRReports", null, { Referer: `${CONFIG.baseUrl}/agent/` }); } catch {}

  let raw = await makeRequest("GET", urlPath, null, {
    Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  if (raw.includes("Direct Script Access") || raw.includes("Please sign in")) {
    await login();
    await makeRequest("GET", "/agent/SMSCDRReports");
    raw = await makeRequest("GET", urlPath, null, {
      Referer: `${CONFIG.baseUrl}/agent/SMSCDRReports`,
      "X-Requested-With": "XMLHttpRequest"
    });
  }

  let json;
  try { json = JSON.parse(raw); } catch { return { error: "Parse failed", preview: raw.substring(0, 200) }; }

  const today = getToday();
  const allRows = (json.aaData || [])
    .map(row => {
      const msg = (row[5] || "").replace(/legendhacker/gi, "").trim();
      if (!msg) return null;
      return [row[0]||"", row[1]||"", row[2]||"", row[3]||"", msg, "$", row[7]||0];
    })
    .filter(Boolean);

  // ✅ Step 1: Sirf aaj ki SMS
  const todayRows = allRows.filter(row => String(row[0]).startsWith(today));

  // ✅ Step 2: Sirf nayi SMS jo pehle nahi dekhi
  const newRows = todayRows.filter(row => !seenIds.has(row[0]));
  todayRows.forEach(row => seenIds.add(row[0]));

  console.log(`[SMS] Aaj ki: ${todayRows.length}, Nayi: ${newRows.length}`);

  return {
    date: today,
    totalToday: todayRows.length,
    newCount: newRows.length,
    newSms: newRows
  };
}

// ✅ Yeh bhi available — saari aaj ki SMS (pehli call)
async function getAllTodaySMS() {
  seenIds.clear();
  return getDailyNewSMS();
}

app.get("/api", async (req, res) => {
  const { type } = req.query;
  try {
    if (!type || type === "new-sms") return res.json(await getDailyNewSMS());
    if (type === "all-today")        return res.json(await getAllTodaySMS());
    res.json({ error: "Use ?type=new-sms ya ?type=all-today" });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server on port ${PORT}`));
