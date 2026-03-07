const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 3000;

// ================ SIRF YAHAN CONFIG HAI ================
const CONFIG = {
  baseUrl: "http://www.timesms.net",  // <-- YAHAN URL
  username: "Junaidaliniz",            // <-- YAHAN USERNAME
  password: "Junaidaliniz",            // <-- YAHAN PASSWORD
  userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile"
};
// ========================================================

let cookies = [];
let csrfToken = "";

/* ================= SAFE JSON ================= */
function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return { 
      error: "Invalid JSON from server", 
      raw: text.substring(0, 200) 
    };
  }
}

/* ================= REQUEST FUNCTION ================= */
function request(method, url, data = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;

    const headers = {
      "User-Agent": CONFIG.userAgent,
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      ...extraHeaders
    };

    if (cookies.length > 0) {
      headers.Cookie = cookies.join("; ");
    }

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    const req = lib.request(url, { 
      method, 
      headers,
      timeout: 30000 
    }, res => {
      if (res.headers["set-cookie"]) {
        res.headers["set-cookie"].forEach(c => {
          const cookie = c.split(";")[0];
          if (!cookies.includes(cookie)) {
            cookies.push(cookie);
          }
        });
      }

      let chunks = [];
      res.on("data", d => chunks.push(d));

      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        
        if (res.headers["content-encoding"] === "gzip") {
          try {
            buffer = zlib.gunzipSync(buffer);
          } catch (e) {
            console.error("Gzip error:", e.message);
          }
        }

        resolve(buffer.toString());
      });
    });

    req.on("error", reject);
    
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (data) req.write(data);
    req.end();
  });
}

/* ================= LOGIN FUNCTION ================= */
async function login() {
  try {
    console.log("🔑 Logging in to timesms.net...");
    cookies = [];
    csrfToken = "";

    const loginPage = await request("GET", `${CONFIG.baseUrl}/login`);
    
    const tokenMatch = loginPage.match(/name="_token"\s+value="([^"]+)"/i) ||
                      loginPage.match(/csrf-token" content="([^"]+)"/i);
    
    if (tokenMatch) {
      csrfToken = tokenMatch[1];
      console.log("✅ CSRF Token found");
    }

    let captchaAnswer = 10;
    const captchaMatch = loginPage.match(/What is (\d+)\s*\+\s*(\d+)/i);
    
    if (captchaMatch) {
      captchaAnswer = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
      console.log(`✅ Captcha: ${captchaMatch[1]} + ${captchaMatch[2]} = ${captchaAnswer}`);
    }

    const loginData = {
      username: CONFIG.username,
      password: CONFIG.password
    };

    if (captchaMatch) {
      loginData.capt = captchaAnswer;
    }

    if (csrfToken) {
      loginData._token = csrfToken;
    }

    const form = querystring.stringify(loginData);

    const response = await request(
      "POST",
      `${CONFIG.baseUrl}/signin`,
      form,
      {
        "Referer": `${CONFIG.baseUrl}/login`,
        "Origin": CONFIG.baseUrl,
        "X-Requested-With": "XMLHttpRequest"
      }
    );

    if (response.includes("dashboard") || 
        response.includes("Welcome") || 
        response.includes("logout")) {
      console.log("✅ Login successful!");
      return true;
    }

    return true;

  } catch (error) {
    console.error("❌ Login error:", error.message);
    throw error;
  }
}

/* ================= FIX NUMBERS DATA ================= */
function fixNumbers(data) {
  if (!data || !data.aaData) return data;

  try {
    data.aaData = data.aaData.map(row => {
      const cleanField = (field) => {
        if (!field) return "";
        return String(field).replace(/<[^>]+>/g, "").trim();
      };

      return [
        cleanField(row[1]), // Number
        "",                 // Empty
        cleanField(row[3]), // Service
        "Weekly",           // Plan
        cleanField(row[4]), // Details
        cleanField(row[7])  // Status
      ];
    });
  } catch (e) {
    console.error("Error fixing numbers:", e.message);
  }

  return data;
}

/* ================= FIX SMS DATA ================= */
function fixSMS(data) {
  if (!data || !data.aaData) return data;

  try {
    data.aaData = data.aaData
      .map(row => {
        let message = String(row[5] || "")
          .replace(/<[^>]+>/g, "")
          .replace(/legendhacker/gi, "")
          .replace(/&[^;]+;/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (!message || message.length < 3) return null;

        return [
          String(row[0] || ""), // Date
          String(row[1] || ""), // From
          String(row[2] || ""), // Number
          String(row[3] || ""), // Service
          message,               // OTP
          "$",                   // Currency
          String(row[7] || "0")  // Cost
        ];
      })
      .filter(Boolean);
  } catch (e) {
    console.error("Error fixing SMS:", e.message);
  }

  return data;
}

/* ================= FETCH NUMBERS ================= */
async function getNumbers() {
  console.log("📱 Fetching numbers...");

  const url = `${CONFIG.baseUrl}/agent/res/data_smsnumbers.php?` +
    `frange=&fclient=&sEcho=2&iColumns=8&` +
    `sColumns=%2C%2C%2C%2C%2C%2C%2C&` +
    `iDisplayStart=0&iDisplayLength=-1&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixNumbers(safeJSON(data));
}

/* ================= FETCH SMS ================= */
async function getSMS() {
  console.log("📨 Fetching SMS...");

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const url = `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59&` +
    `iDisplayLength=5000&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixSMS(safeJSON(data));
}

/* ================= HEALTH CHECK ================= */
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString()
  });
});

/* ================= API ROUTES ================= */

// Home route
app.get("/", async (req, res) => {
  const { type, username, password } = req.query;

  if (username) CONFIG.username = username;
  if (password) CONFIG.password = password;

  if (!type) {
    return res.json({
      name: "timesms.net API",
      version: "1.0.0",
      status: "running",
      endpoints: {
        numbers: "/?type=numbers",
        sms: "/?type=sms",
        test: "/test",
        health: "/health"
      },
      config: {
        baseUrl: CONFIG.baseUrl,
        username: CONFIG.username,
        passwordSet: CONFIG.password ? "✅ Yes" : "❌ No"
      }
    });
  }

  try {
    await login();

    let result;
    if (type === "numbers") {
      result = await getNumbers();
    } else if (type === "sms") {
      result = await getSMS();
    } else {
      return res.json({ error: "Invalid type. Use 'numbers' or 'sms'" });
    }

    res.json({
      success: true,
      type: type,
      url: CONFIG.baseUrl,
      count: result.aaData ? result.aaData.length : 0,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      type: type,
      url: CONFIG.baseUrl
    });
  }
});

// Test route
app.get("/test", async (req, res) => {
  try {
    const response = await request("GET", `${CONFIG.baseUrl}/login`);
    
    res.json({
      status: "✅ timesms.net is reachable",
      url: CONFIG.baseUrl,
      responseLength: response.length,
      hasLoginForm: response.includes("login") || response.includes("Login")
    });
  } catch (error) {
    res.json({
      status: "❌ timesms.net is not reachable",
      url: CONFIG.baseUrl,
      error: error.message
    });
  }
});

// Update config route
app.get("/update", (req, res) => {
  const { url, username, password } = req.query;
  
  if (url) CONFIG.baseUrl = url;
  if (username) CONFIG.username = username;
  if (password) CONFIG.password = password;
  
  res.json({
    success: true,
    message: "Configuration updated",
    currentConfig: {
      baseUrl: CONFIG.baseUrl,
      username: CONFIG.username,
      passwordSet: CONFIG.password ? "Yes" : "No"
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     timesms.net API Server           ║
╠══════════════════════════════════════╣
║  Port: ${PORT}                        
║  URL: ${CONFIG.baseUrl}  
║  Username: ${CONFIG.username}          
║  Status: ✅ Active                     
╚══════════════════════════════════════╝
  `);
});
