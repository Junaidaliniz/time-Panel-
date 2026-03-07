const express = require('express');
const axios = require('axios');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ================ CONFIGURATION (TIMESMS PANEL) ================
const CREDENTIALS = {
    username: "Junaidaliniz",
    password: "Junaidaliniz"
};

const BASE_URL = "http://www.timesms.net";

// Pages for key extraction
const SMS_STATS_PAGE = `${BASE_URL}/agent/SMSCDRReports`; // Agent page
const NUMBERS_PAGE = `${BASE_URL}/agent/MySMSNumbers`;

const COMMON_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/144 Mobile",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "http://www.timesms.net",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,ur-PK;q=0.8,ur;q=0.7"
};

// ================ GLOBAL STATE ================
let STATE = {
    cookie: null,
    csrfToken: null,
    isLoggingIn: false,
    lastLogin: null
};

// ================ HELPER: GET CURRENT DATE ================
function getTodayDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ================ HELPER: EXTRACT CSRF TOKEN ================
function extractCsrfToken(html) {
    let match = html.match(/name="_token"\s+value="([^"]+)"/i) ||
                html.match(/csrf-token" content="([^"]+)"/i);
    return match ? match[1] : null;
}

// ================ HELPER: EXTRACT CAPTCHA ================
function extractCaptcha(html) {
    const match = html.match(/What is (\d+)\s*\+\s*(\d+)/i);
    if (match) {
        return parseInt(match[1]) + parseInt(match[2]);
    }
    return 10; // Default
}

// ================ HELPER: FORM ENCODE ================
function encodeFormData(data) {
    return Object.keys(data)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(data[key]))
        .join('&');
}

// ================ HELPER: SAFE JSON ================
function safeJSON(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return { error: "Invalid JSON", raw: text?.substring(0, 200) };
    }
}

// ================ MAIN LOGIN FUNCTION ================
async function performLogin() {
    if (STATE.isLoggingIn) return STATE;
    STATE.isLoggingIn = true;
    
    console.log("🔄 System: Logging in to timesms.net...");

    try {
        const instance = axios.create({ 
            withCredentials: true, 
            headers: COMMON_HEADERS,
            timeout: 15000,
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true })
        });

        // STEP 1: Get login page (for CSRF token and cookies)
        console.log("📄 Fetching login page...");
        const r1 = await instance.get(`${BASE_URL}/login`);
        
        // Save cookie
        if (r1.headers['set-cookie']) {
            const sessionCookie = r1.headers['set-cookie'].find(c => c.includes('PHPSESSID') || c.includes('session'));
            if (sessionCookie) {
                STATE.cookie = sessionCookie.split(';')[0];
                console.log("🍪 Cookie saved");
            }
        }

        // Extract CSRF token
        STATE.csrfToken = extractCsrfToken(r1.data);
        if (STATE.csrfToken) {
            console.log("✅ CSRF Token found");
        }

        // Solve captcha
        const captchaAnswer = extractCaptcha(r1.data);
        console.log("🔢 Captcha answer:", captchaAnswer);

        // STEP 2: Submit login form
        console.log("📤 Submitting login form...");
        
        const loginData = {
            username: CREDENTIALS.username,
            password: CREDENTIALS.password,
            capt: captchaAnswer
        };

        if (STATE.csrfToken) {
            loginData._token = STATE.csrfToken;
        }

        const formData = encodeFormData(loginData);

        const r2 = await instance.post(`${BASE_URL}/signin`, formData, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": STATE.cookie || "",
                "Referer": `${BASE_URL}/login`,
                "Origin": BASE_URL
            },
            maxRedirects: 0,
            validateStatus: status => status < 400 || status === 302
        });

        // Update cookie if new one received
        if (r2.headers['set-cookie']) {
            const newCookie = r2.headers['set-cookie'].find(c => c.includes('PHPSESSID') || c.includes('session'));
            if (newCookie) {
                STATE.cookie = newCookie.split(';')[0];
            }
        }

        // STEP 3: Verify login by accessing a protected page
        console.log("🔍 Verifying login...");
        
        const r3 = await instance.get(SMS_STATS_PAGE, {
            headers: { 
                ...COMMON_HEADERS, 
                "Cookie": STATE.cookie,
                "Referer": `${BASE_URL}/agent/dashboard`
            }
        });

        // Check if login was successful
        if (r3.data.includes('logout') || r3.data.includes('dashboard') || !r3.data.includes('login')) {
            console.log("✅ Login successful!");
            STATE.lastLogin = new Date();
        } else {
            console.log("⚠️ Login may have failed");
        }

    } catch (error) {
        console.error("❌ Login failed:", error.message);
    } finally {
        STATE.isLoggingIn = false;
    }
    
    return STATE;
}

// ================ AUTO REFRESH LOGIN ================
setInterval(() => {
    performLogin();
}, 180000); // Har 3 minute mein refresh

// ================ FETCH SMS FUNCTION ================
async function fetchSMS() {
    const ts = Date.now();
    const today = getTodayDate();
    
    // Complete SMS URL with all parameters
    const targetUrl = `${BASE_URL}/agent/res/data_smscdr.php?` +
        `fdate1=${today}%2000:00:00&fdate2=${today}%2023:59:59&` +
        `frange=&fclient=&fnum=&fcli=&fgdate=&fgmonth=&fgrange=&fgclient=&fgnumber=&fgcli=&fg=0&` +
        `sEcho=1&iColumns=9&sColumns=%2C%2C%2C%2C%2C%2C%2C%2C&` +
        `iDisplayStart=0&iDisplayLength=5000&` +
        `sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=desc&iSortingCols=1&_=${ts}`;

    console.log("📨 Fetching SMS data...");

    const response = await axios.get(targetUrl, {
        headers: { 
            ...COMMON_HEADERS, 
            "Cookie": STATE.cookie,
            "Referer": SMS_STATS_PAGE
        },
        responseType: 'arraybuffer',
        timeout: 25000
    });

    // Handle gzip decompression if needed
    let data = response.data;
    if (response.headers['content-encoding'] === 'gzip') {
        const zlib = require('zlib');
        data = zlib.gunzipSync(Buffer.from(data));
    }

    const textData = data.toString();
    
    // Check if session expired
    if (textData.includes('<html') || textData.includes('login')) {
        throw new Error("Session expired");
    }

    return safeJSON(textData);
}

// ================ FETCH NUMBERS FUNCTION ================
async function fetchNumbers() {
    const ts = Date.now();
    
    // Complete Numbers URL
    const targetUrl = `${BASE_URL}/agent/res/data_smsnumbers.php?` +
        `frange=&fclient=&sEcho=2&iColumns=8&sColumns=%2C%2C%2C%2C%2C%2C%2C&` +
        `iDisplayStart=0&iDisplayLength=-1&` +
        `sSearch=&bRegex=false&iSortCol_0=0&sSortDir_0=asc&iSortingCols=1&_=${ts}`;

    console.log("📱 Fetching numbers data...");

    const response = await axios.get(targetUrl, {
        headers: { 
            ...COMMON_HEADERS, 
            "Cookie": STATE.cookie,
            "Referer": NUMBERS_PAGE
        },
        responseType: 'arraybuffer',
        timeout: 25000
    });

    // Handle gzip decompression if needed
    let data = response.data;
    if (response.headers['content-encoding'] === 'gzip') {
        const zlib = require('zlib');
        data = zlib.gunzipSync(Buffer.from(data));
    }

    const textData = data.toString();
    
    // Check if session expired
    if (textData.includes('<html') || textData.includes('login')) {
        throw new Error("Session expired");
    }

    return safeJSON(textData);
}

// ================ API ENDPOINTS ================

// Main API endpoint
app.get('/api', async (req, res) => {
    const { type } = req.query;

    // Agar login nahi hai to pehle login karo
    if (!STATE.cookie || !STATE.lastLogin) {
        await performLogin();
        if (!STATE.cookie) {
            return res.status(500).json({ 
                success: false, 
                error: "Login failed. Check credentials." 
            });
        }
    }

    if (!type) {
        return res.json({
            name: "TimeSMS API",
            version: "1.0.0",
            endpoints: {
                sms: "/api?type=sms",
                numbers: "/api?type=numbers",
                debug: "/debug",
                status: "/status"
            }
        });
    }

    try {
        let result;
        
        if (type === 'sms') {
            result = await fetchSMS();
        } else if (type === 'numbers') {
            result = await fetchNumbers();
        } else {
            return res.status(400).json({ 
                success: false, 
                error: "Invalid type. Use 'sms' or 'numbers'" 
            });
        }

        // Format response to match working API
        res.json({
            success: true,
            type: type,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("❌ API Error:", error.message);
        
        // Agar session expire ho gaya to login karo
        if (error.message.includes("Session expired")) {
            await performLogin();
            res.status(503).json({ 
                success: false, 
                error: "Session expired. Please retry.",
                retry: true
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: error.message 
            });
        }
    }
});

// Debug endpoint
app.get('/debug', async (req, res) => {
    const status = {
        loggedIn: !!STATE.cookie,
        cookie: STATE.cookie ? "✅ Present" : "❌ Missing",
        lastLogin: STATE.lastLogin,
        isLoggingIn: STATE.isLoggingIn,
        config: {
            baseUrl: BASE_URL,
            username: CREDENTIALS.username
        }
    };

    try {
        // Test connection to panel
        const test = await axios.get(`${BASE_URL}/login`, { timeout: 5000 });
        status.panelReachable = test.status === 200 ? "✅ Yes" : "❌ No";
        
        if (STATE.cookie) {
            // Test authenticated page
            const testAuth = await axios.get(SMS_STATS_PAGE, {
                headers: { Cookie: STATE.cookie },
                timeout: 5000
            });
            status.sessionValid = testAuth.data.includes('logout') ? "✅ Yes" : "❌ No";
        }
    } catch (error) {
        status.panelError = error.message;
    }

    res.json(status);
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        status: "✅ API Running",
        time: new Date().toISOString(),
        loginStatus: STATE.cookie ? "Logged In" : "Not Logged In",
        lastLogin: STATE.lastLogin
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ 
        status: "✅ Server is working",
        endpoints: {
            sms: "/api?type=sms",
            numbers: "/api?type=numbers",
            debug: "/debug",
            status: "/status"
        }
    });
});

// ================ START SERVER ================
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════╗
║   TimeSMS API Server v1.0        ║
╠══════════════════════════════════╣
║  Port: ${PORT}                      
║  Panel: ${BASE_URL}   
║  Username: ${CREDENTIALS.username}  
║  Status: ✅ Running                 
╚══════════════════════════════════╝
    `);
    
    // Initial login
    performLogin();
});
