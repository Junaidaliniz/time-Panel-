const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");

const app = express();
const PORT = process.env.PORT || 3000;

// ================ CONFIG ================
const CONFIG = {
  baseUrl: "http://www.timesms.net",
  username: "Junaidaliniz",
  password: "Junaidaliniz",
  userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile"
};

let cookies = [];
let csrfToken = "";
// ========================================

/* ================= SAFE JSON ================= */
function safeJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return { 
      error: "Invalid JSON from server", 
      raw: text?.substring(0, 200) || "Empty response"
    };
  }
}

/* ================= FORM DATA ENCODE ================= */
function encodeFormData(data) {
  return Object.keys(data)
    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
    .join('&');
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
      timeout: 15000 
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
          } catch (e) {}
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
    cookies = [];
    csrfToken = "";

    const loginPage = await request("GET", `${CONFIG.baseUrl}/login`);
    
    // Extract CSRF token
    const tokenMatch = loginPage.match(/name="_token"\s+value="([^"]+)"/i) ||
                      loginPage.match(/csrf-token" content="([^"]+)"/i);
    
    if (tokenMatch) {
      csrfToken = tokenMatch[1];
    }

    // Check for captcha
    let captchaAnswer = 10;
    const captchaMatch = loginPage.match(/What is (\d+)\s*\+\s*(\d+)/i);
    
    if (captchaMatch) {
      captchaAnswer = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
    }

    // Prepare login data
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

    const form = encodeFormData(loginData);

    // Submit login
    await request(
      "POST",
      `${CONFIG.baseUrl}/signin`,
      form,
      {
        "Referer": `${CONFIG.baseUrl}/login`,
        "Origin": CONFIG.baseUrl
      }
    );

    return cookies.length > 0;

  } catch (error) {
    console.error("Login error:", error.message);
    return false;
  }
}

/* ================= FETCH NUMBERS ================= */
async function getNumbers() {
  const url = `${CONFIG.baseUrl}/agent/res/data_smsnumbers.php?iDisplayStart=0&iDisplayLength=-1&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return safeJSON(data);
}

/* ================= FETCH SMS - WORKING VERSION ================= */
async function getSMS() {
  console.log("📨 Fetching SMS...");

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const url = `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59&` +
    `iDisplayLength=100&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  const jsonData = safeJSON(data);
  
  // ✅ FIX: OTP ko sahi index se nikaalo
  if (jsonData && jsonData.aaData && Array.isArray(jsonData.aaData)) {
    // Pehle extra array ko filter karo
    const cleanData = jsonData.aaData.filter(row => Array.isArray(row) && row.length > 5);
    
    jsonData.aaData = cleanData
      .map(row => {
        // ✅ IMPORTANT: OTP index 5 mein hai (kyunki index 4 null hai)
        let message = "";
        
        // Check karo konse index mein message hai
        if (row[5] && typeof row[5] === 'string' && row[5].length > 5) {
          message = row[5]; // OTP yahan hai
        } else if (row[4] && typeof row[4] === 'string' && row[4].length > 5) {
          message = row[4]; // Backup
        }
        
        // Clean message
        message = message.replace(/<[^>]+>/g, '').trim();
        
        if (!message) return null;
        
        // Return in same format as working API
        return [
          row[0] || '', // date
          row[1] || '', // service
          row[2] || '', // number
          row[3] || '', // type
          message,       // ✅ OTP message yahan hai
          "$",          // currency
          row[7] || '0' // cost
        ];
      })
      .filter(Boolean);
  }
  
  return jsonData;
}

/* ================= ROUTES ================= */

// Main route
app.get("/", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      name: "Time SMS API",
      version: "2.0.0",
      endpoints: {
        numbers: "/?type=numbers",
        sms: "/?type=sms",
        debug: "/debug",
        test: "/test"
      },
      config: {
        baseUrl: CONFIG.baseUrl,
        username: CONFIG.username
      }
    });
  }

  try {
    const loggedIn = await login();
    
    if (!loggedIn) {
      return res.json({
        success: false,
        error: "Login failed"
      });
    }

    let result;
    if (type === "numbers") {
      result = await getNumbers();
    } else if (type === "sms") {
      result = await getSMS();
    } else {
      return res.json({ error: "Invalid type" });
    }

    res.json({
      success: true,
      type: type,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// OTP test route - Sirf OTP messages dikhane ke liye
app.get("/otp", async (req, res) => {
  try {
    await login();
    const smsData = await getSMS();
    
    const otpList = [];
    
    if (smsData && smsData.aaData && Array.isArray(smsData.aaData)) {
      smsData.aaData.forEach(row => {
        if (Array.isArray(row) && row.length >= 5) {
          otpList.push({
            date: row[0] || '',
            service: row[1] || '',
            number: row[2] || '',
            type: row[3] || '',
            message: row[4] || '', // ✅ OTP yahan display hoga
            raw: row
          });
        }
      });
    }
    
    res.json({
      total: otpList.length,
      otps: otpList.slice(0, 20)
    });
    
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Debug route
app.get("/debug", async (req, res) => {
  try {
    const website = await request("GET", CONFIG.baseUrl);
    const loginStatus = await login();
    
    res.json({
      website: website.length > 0 ? "✅ Reachable" : "❌ Not reachable",
      login: loginStatus ? "✅ Success" : "❌ Failed",
      cookies: cookies.length,
      config: {
        baseUrl: CONFIG.baseUrl,
        username: CONFIG.username
      }
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// Test route
app.get("/test", (req, res) => {
  res.json({
    status: "✅ API is working",
    time: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════╗
║   Time SMS API v2.0        ║
╠════════════════════════════╣
║  Port: ${PORT}               
║  URL: ${CONFIG.baseUrl}     
║  OTP: /otp                 
║  SMS: /?type=sms           
╚════════════════════════════╝
  `);
});
