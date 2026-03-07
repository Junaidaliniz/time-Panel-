const express = require("express");
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const querystring = require("querystring");

const app = express();
const PORT = process.env.PORT || 3000;

// ================ CONFIGURATION ================
const CONFIG = {
  baseUrl: "http://www.timesms.net",  // <-- YAHAN URL CHANGE KARO
  username: "Junaidaliniz",            // <-- YAHAN USERNAME
  password: "Junaidaliniz",            // <-- YAHAN PASSWORD
  userAgent: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile"
};

let cookies = [];
let csrfToken = "";
// ==============================================

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

    // Add cookies if available
    if (cookies.length > 0) {
      headers.Cookie = cookies.join("; ");
    }

    // Add CSRF token if available
    if (csrfToken && extraHeaders["X-Requested-With"]) {
      headers["X-CSRF-TOKEN"] = csrfToken;
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
      // Store cookies
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
        
        // Handle gzip decompression
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

    // Step 1: Get login page
    const loginPage = await request("GET", `${CONFIG.baseUrl}/login`);
    
    // Step 2: Extract CSRF token
    const tokenMatch = loginPage.match(/name="_token"\s+value="([^"]+)"/i) ||
                      loginPage.match(/csrf-token" content="([^"]+)"/i) ||
                      loginPage.match(/CSRF" value="([^"]+)"/i);
    
    if (tokenMatch) {
      csrfToken = tokenMatch[1];
      console.log("✅ CSRF Token found");
    }

    // Step 3: Check for captcha
    let captchaAnswer = 10;
    const captchaMatch = loginPage.match(/What is (\d+)\s*\+\s*(\d+)/i) ||
                        loginPage.match(/captcha.*?(\d+).*?\+.*?(\d+)/i);
    
    if (captchaMatch) {
      captchaAnswer = parseInt(captchaMatch[1]) + parseInt(captchaMatch[2]);
      console.log(`✅ Captcha: ${captchaMatch[1]} + ${captchaMatch[2]} = ${captchaAnswer}`);
    }

    // Step 4: Prepare login data
    const loginData = {
      username: CONFIG.username,
      password: CONFIG.password
    };

    // Add captcha if found
    if (captchaMatch) {
      loginData.capt = captchaAnswer;
    }

    // Add CSRF token if found
    if (csrfToken) {
      loginData._token = csrfToken;
    }

    const form = querystring.stringify(loginData);

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

    // Step 6: Check if login successful
    if (response.includes("dashboard") || 
        response.includes("Welcome") || 
        response.includes("logout")) {
      console.log("✅ Login successful!");
      return true;
    } else if (response.includes("Invalid") || response.includes("failed")) {
      console.log("❌ Login failed - Invalid credentials");
      return false;
    }

    console.log("⚠️ Login status unknown, proceeding...");
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
      // Clean HTML tags from fields
      const cleanField = (field) => {
        if (!field) return "";
        return String(field).replace(/<[^>]+>/g, "").trim();
      };

      return [
        cleanField(row[1]), // Number
        "",                 // Empty field
        cleanField(row[3]), // Service/Provider
        "Weekly",           // Default plan
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
        // Clean message
        let message = String(row[5] || "")
          .replace(/<[^>]+>/g, "")     // Remove HTML tags
          .replace(/legendhacker/gi, "") // Remove specific text
          .replace(/&[^;]+;/g, " ")    // Remove HTML entities
          .replace(/\s+/g, " ")         // Fix multiple spaces
          .trim();

        // Skip empty messages
        if (!message || message.length < 3) return null;

        return [
          String(row[0] || ""), // Date
          String(row[1] || ""), // From/Range
          String(row[2] || ""), // Number/To
          String(row[3] || ""), // Service
          message,               // OTP/Message
          "$",                   // Currency
          String(row[7] || "0")  // Cost/Status
        ];
      })
      .filter(Boolean); // Remove null entries
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
    `iDisplayStart=0&iDisplayLength=-1&` +
    `mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=false&` +
    `mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&` +
    `mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&` +
    `mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&` +
    `mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&` +
    `mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&` +
    `mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&` +
    `mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=false&` +
    `sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${Date.now()}`;

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
    `frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0&` +
    `sEcho=1&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&` +
    `iDisplayStart=0&iDisplayLength=25&` +
    `mDataProp_0=0&sSearch_0=&bRegex_0=false&bSearchable_0=true&bSortable_0=true&` +
    `mDataProp_1=1&sSearch_1=&bRegex_1=false&bSearchable_1=true&bSortable_1=true&` +
    `mDataProp_2=2&sSearch_2=&bRegex_2=false&bSearchable_2=true&bSortable_2=true&` +
    `mDataProp_3=3&sSearch_3=&bRegex_3=false&bSearchable_3=true&bSortable_3=true&` +
    `mDataProp_4=4&sSearch_4=&bRegex_4=false&bSearchable_4=true&bSortable_4=true&` +
    `mDataProp_5=5&sSearch_5=&bRegex_5=false&bSearchable_5=true&bSortable_5=true&` +
    `mDataProp_6=6&sSearch_6=&bRegex_6=false&bSearchable_6=true&bSortable_6=true&` +
    `mDataProp_7=7&sSearch_7=&bRegex_7=false&bSearchable_7=true&bSortable_7=true&` +
    `mDataProp_8=8&sSearch_8=&bRegex_8=false&bSearchable_8=true&bSortable_8=false&` +
    `sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${Date.now()}`;

  const data = await request("GET", url, null, {
    "Referer": `${CONFIG.baseUrl}/agent/SMSCDRReports`,
    "X-Requested-With": "XMLHttpRequest"
  });

  return fixSMS(safeJSON(data));
}

/* ================= API ROUTES ================= */

// Home route
app.get("/", async (req, res) => {
  const { type, username, password } = req.query;

  // Update credentials if provided in URL
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
        info: "/info"
      },
      config: {
        baseUrl: CONFIG.baseUrl,
        username: CONFIG.username,
        passwordSet: CONFIG.password ? "✅ Yes" : "❌ No"
      }
    });
  }

  try {
    // Login first
    await login();

    // Fetch data based on type
    let result;
    if (type === "numbers") {
      result = await getNumbers();
    } else if (type === "sms") {
      result = await getSMS();
    } else {
      return res.json({ error: "Invalid type. Use 'numbers' or 'sms'" });
    }

    // Return response
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
    // Simple test to check if website is reachable
    const response = await request("GET", `${CONFIG.baseUrl}/login`);
    
    res.json({
      status: "✅ timesms.net is reachable",
      url: CONFIG.baseUrl,
      responseLength: response.length,
      hasLoginForm: response.includes("login") || response.includes("Login"),
      config: {
        username: CONFIG.username,
        passwordSet: CONFIG.password ? "Yes" : "No"
      }
    });
  } catch (error) {
    res.json({
      status: "❌ timesms.net is not reachable",
      url: CONFIG.baseUrl,
      error: error.message
    });
  }
});

// Info route
app.get("/info", (req, res) => {
  res.json({
    name: "timesms.net API",
    description: "SMS Panel API for timesms.net",
    version: "1.0.0",
    author: "Junaidaliniz",
    endpoints: {
      "GET /": "Main endpoint with type parameter",
      "GET /?type=numbers": "Fetch all numbers",
      "GET /?type=sms": "Fetch today's SMS",
      "GET /test": "Test connection",
      "GET /info": "This info"
    },
    config: {
      baseUrl: CONFIG.baseUrl,
      username: CONFIG.username
    }
  });
});

// ================ UPDATE CONFIG ROUTE ================
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
║   timesms.net API Server Running     ║
╠══════════════════════════════════════╣
║  Port: ${PORT}                        
║  URL: ${CONFIG.baseUrl}  
║  Username: ${CONFIG.username}          
║  Status: ✅ Active                     
╚══════════════════════════════════════╝
  `);
});
