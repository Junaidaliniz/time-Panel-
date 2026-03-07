const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

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
      raw: text.substring(0, 500) // Raw data dikhega debugging ke liye
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
      ...extraHeaders
    };

    if (cookies.length > 0) {
      headers.Cookie = cookies.join("; ");
    }

    if (method === "POST" && data) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers["Content-Length"] = Buffer.byteLength(data);
    }

    console.log(`🌐 ${method} ${url}`);

    const req = lib.request(url, { 
      method, 
      headers,
      timeout: 30000 
    }, res => {
      console.log(`📥 Response Status: ${res.statusCode}`);

      if (res.headers["set-cookie"]) {
        console.log(`🍪 New Cookies: ${res.headers["set-cookie"].length}`);
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
            console.log("📦 Gzip decompressed");
          } catch (e) {
            console.error("Gzip error:", e.message);
          }
        }

        const responseText = buffer.toString();
        console.log(`📄 Response Length: ${responseText.length} chars`);
        
        if (responseText.length < 200) {
          console.log(`📄 Response Preview: ${responseText}`);
        }
        
        resolve(responseText);
      });
    });

    req.on("error", reject);
    
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (data) {
      console.log(`📤 Data: ${data}`);
      req.write(data);
    }
    req.end();
  });
}

/* ================= LOGIN FUNCTION ================= */
async function login() {
  try {
    console.log("\n🔑 Logging in to timesms.net...");
    cookies = [];
    csrfToken = "";

    // Step 1: Get login page
    console.log("📄 Fetching login page...");
    const loginPage = await request("GET", `${CONFIG.baseUrl}/login`);
    
    // Check if login page is accessible
    if (loginPage.includes("404") || loginPage.includes("Not Found")) {
      throw new Error("Login page not found (404)");
    }

    // Step 2: Extract CSRF token
    const tokenMatch = loginPage.match(/name="_token"\s+value="([^"]+)"/i) ||
                      loginPage.match(/csrf-token" content="([^"]+)"/i) ||
                      loginPage.match(/name="csrf_token"\s+value="([^"]+)"/i);
    
    if (tokenMatch) {
      csrfToken = tokenMatch[1];
      console.log("✅ CSRF Token found");
    } else {
      console.log("⚠️ No CSRF token found");
    }

    // Step 3: Check for captcha
    let captchaAnswer = 10;
    const captchaMatch = loginPage.match(/What is (\d+)\s*\+\s*(\d+)/i) ||
                        loginPage.match(/captcha.*?(\d+).*?\+.*?(\d+)/i);
    
    if (captchaMatch) {
      captchaAnswer = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
      console.log(`✅ Captcha: ${captchaMatch[1]} + ${captchaMatch[2]} = ${captchaAnswer}`);
    } else {
      console.log("⚠️ No captcha found");
    }

    // Step 4: Prepare login data
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
    console.log("📤 Submitting login form...");

    // Step 5: Submit login
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

    // Step 6: Check login result
    if (response.includes("dashboard") || 
        response.includes("Welcome") || 
        response.includes("logout") ||
        cookies.length > 0) {
      console.log("✅ Login successful!");
      console.log(`🍪 Cookies: ${cookies.length} cookies stored`);
      return true;
    } else {
      console.log("⚠️ Login may have failed. Response:", response.substring(0, 200));
      return false;
    }

  } catch (error) {
    console.error("❌ Login error:", error.message);
    throw error;
  }
}

/* ================= FETCH SMS WITH DEBUG ================= */
async function getSMS() {
  console.log("\n📨 Fetching SMS...");

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Try different URL patterns
  const urls = [
    // Pattern 1: Simple
    `${CONFIG.baseUrl}/agent/res/data_smscdr.php?fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59&iDisplayLength=5000`,
    
    // Pattern 2: With all parameters
    `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59&` +
    `frange=&fclient=&fnum=&fcli=&fg=0&` +
    `iDisplayStart=0&iDisplayLength=5000&_=${Date.now()}`,
    
    // Pattern 3: Original from Replit
    `${CONFIG.baseUrl}/agent/res/data_smscdr.php?` +
    `fdate1=${dateStr}%2000:00:00&fdate2=${dateStr}%2023:59:59&` +
    `frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0&` +
    `sEcho=1&iColumns=9&iDisplayStart=0&iDisplayLength=5000`
  ];

  // Try each URL pattern
  for (let i = 0; i < urls.length; i++) {
    console.log(`\n🔍 Trying URL pattern ${i + 1}:`);
    console.log(urls[i].substring(0, 100) + "...");

    try {
      const data = await request("GET", urls[i], null, {
        "Referer": `${CONFIG.baseUrl}/agent/SMSCDRReports`,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01"
      });

      // Check if response is HTML (login page)
      if (data.includes("<html") || data.includes("<!DOCTYPE")) {
        console.log("⚠️ Got HTML response -可能 login required or session expired");
        continue;
      }

      // Try to parse JSON
      try {
        const jsonData = JSON.parse(data);
        console.log(`✅ URL pattern ${i + 1} worked!`);
        console.log(`📊 Data count: ${jsonData.aaData ? jsonData.aaData.length : 0}`);
        return jsonData;
      } catch (e) {
        console.log(`❌ Invalid JSON from pattern ${i + 1}`);
        console.log(`Raw response: ${data.substring(0, 200)}`);
      }
    } catch (error) {
      console.log(`❌ Request failed for pattern ${i + 1}:`, error.message);
    }
  }

  throw new Error("All SMS endpoints failed");
}

/* ================= FETCH NUMBERS ================= */
async function getNumbers() {
  console.log("\n📱 Fetching numbers...");

  const url = `${CONFIG.baseUrl}/agent/res/data_smsnumbers.php?` +
    `iDisplayStart=0&iDisplayLength=-1&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/MySMSNumbers`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return safeJSON(data);
}

/* ================= ROUTES ================= */

// Debug route - pehle yeh use karo
app.get("/debug", async (req, res) => {
  const results = {
    steps: [],
    cookies: [],
    error: null
  };

  try {
    // Step 1: Check if website exists
    results.steps.push({ name: "Website Check", status: "pending" });
    const websiteCheck = await request("GET", CONFIG.baseUrl);
    results.steps[0].status = websiteCheck.includes("timesms") ? "✅ Found" : "⚠️ Unknown";
    
    // Step 2: Check login page
    results.steps.push({ name: "Login Page", status: "pending" });
    const loginPage = await request("GET", `${CONFIG.baseUrl}/login`);
    results.steps[1].status = loginPage.includes("login") ? "✅ Found" : "❌ Not Found";
    
    // Step 3: Try login
    results.steps.push({ name: "Login Attempt", status: "pending" });
    await login();
    results.steps[2].status = `✅ Done (${cookies.length} cookies)`;
    results.cookies = cookies;
    
    // Step 4: Check SMS endpoint
    results.steps.push({ name: "SMS Endpoint", status: "pending" });
    try {
      const smsTest = await request("GET", `${CONFIG.baseUrl}/agent/res/data_smscdr.php`, null, {
        "X-Requested-With": "XMLHttpRequest"
      });
      results.steps[3].status = smsTest.includes("aaData") ? "✅ Working" : "⚠️ Not Working";
      results.smsPreview = smsTest.substring(0, 200);
    } catch (e) {
      results.steps[3].status = "❌ Failed";
    }

  } catch (error) {
    results.error = error.message;
  }

  res.json(results);
});

// Main route
app.get("/", async (req, res) => {
  const { type } = req.query;

  if (!type) {
    return res.json({
      message: "timesms.net API",
      usage: {
        numbers: "/?type=numbers",
        sms: "/?type=sms",
        debug: "/debug"
      }
    });
  }

  try {
    // Pehle login karo
    await login();

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
      error: error.message,
      type: type,
      debug: "Please try /debug first to see what's wrong"
    });
  }
});

// Test route
app.get("/test", async (req, res) => {
  try {
    const response = await request("GET", `${CONFIG.baseUrl}/login`);
    res.json({
      status: response.includes("login") ? "✅ Working" : "⚠️ Unknown",
      url: CONFIG.baseUrl
    });
  } catch (error) {
    res.json({ status: "❌ Failed", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║     timesms.net API (Debug Mode)     ║
╠══════════════════════════════════════╣
║  Port: ${PORT}                        
║  URL: ${CONFIG.baseUrl}  
║  Debug: /debug                       
║  Test: /test                         
╚══════════════════════════════════════╝
  `);
});
