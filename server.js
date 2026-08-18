// server.js - FINAL with RSS News
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const WebSocket = require('ws');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Parser = require('rss-parser');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---- RSS Parser ----
const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0' }
});

console.log('\n🔍 Environment Check:');
console.log(`🌤️ WEATHER_API_KEY: ${process.env.WEATHER_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`📰 NEWS: Using RSS feeds (no API key required)`);
console.log(`🔑 JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Set' : '❌ Missing'}`);
console.log(`📁 DB_PATH: ${process.env.DB_PATH || '/tmp/data'}\n`);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ---- Database ----
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');
const TRIALS_FILE = path.join(DB_PATH, 'trials.json');
const MESSAGES_FILE = path.join(DB_PATH, 'messages.json');
const DOWNLOADS_PATH = path.join(DB_PATH, 'downloads');

if (!fs.existsSync(DB_PATH)) fs.mkdirSync(DB_PATH, { recursive: true });
if (!fs.existsSync(DOWNLOADS_PATH)) fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });

function initDB() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            const defaultUsers = {
                admin: {
                    username: 'blessed',
                    password: bcrypt.hashSync('emmanuel', 10),
                    role: 'admin',
                    created: new Date().toISOString(),
                    deviceId: null
                }
            };
            fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
            console.log('✅ Users database initialized');
        }
        if (!fs.existsSync(TRIALS_FILE)) {
            fs.writeFileSync(TRIALS_FILE, JSON.stringify({}, null, 2));
            console.log('✅ Trials database initialized');
        }
        if (!fs.existsSync(MESSAGES_FILE)) {
            fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
            console.log('✅ Messages database initialized');
        }
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}
initDB();

// ---- Multer ----
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `doc_${Date.now()}_${file.originalname}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ---- In-memory stores ----
const clients = new Map();
const readingStates = {};

// ---- DB helpers ----
function getUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return { admin: { username: 'blessed', password: bcrypt.hashSync('emmanuel', 10), role: 'admin', deviceId: null } }; }
}
function saveUsers(users) { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function getTrials() {
    try { return JSON.parse(fs.readFileSync(TRIALS_FILE, 'utf8')); } catch { return {}; }
}
function saveTrials(trials) { fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials, null, 2)); }
function getMessages() {
    try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); } catch { return []; }
}
function saveMessages(messages) { fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2)); }

function generateUserId() {
    const users = getUsers();
    const ids = Object.keys(users).filter(k => k !== 'admin');
    if (ids.length === 0) return 'USER001';
    const max = ids.reduce((a, id) => Math.max(a, parseInt(id.replace('USER', ''))), 0);
    return `USER${String(max + 1).padStart(3, '0')}`;
}
function getUserTrials(userId) {
    const trials = getTrials();
    return trials[userId] || { used: 0, total: 5, expiry: null };
}
function hasTrialAvailable(userId) {
    const t = getUserTrials(userId);
    if (t.expiry) return new Date(t.expiry) > new Date();
    return t.used < t.total;
}
function useTrial(userId) {
    const trials = getTrials();
    if (!trials[userId]) trials[userId] = { used: 0, total: 5, expiry: null };
    if (trials[userId].expiry) return true;
    if (trials[userId].used < trials[userId].total) {
        trials[userId].used++;
        saveTrials(trials);
        return true;
    }
    return false;
}

// ---- WebSocket ----
wss.on('connection', (ws, req) => {
    let userId = null;
    let authenticated = false;
    let pingInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
    ws.on('pong', () => {});

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'auth') {
                const { username, password, isNewUser, deviceId } = data;
                const users = getUsers();
                let foundUser = null, foundUserId = null;

                // Admin login
                if (username === 'blessed') {
                    const isValid = bcrypt.compareSync(password, users.admin.password);
                    if (isValid) {
                        foundUser = users.admin;
                        foundUserId = 'admin';
                        foundUser.role = 'admin';
                    } else {
                        ws.send(JSON.stringify({ type: 'auth_failed', data: 'Invalid admin credentials' }));
                        return;
                    }
                } else {
                    // Existing user
                    for (const [id, user] of Object.entries(users)) {
                        if (user.username === username && id !== 'admin') {
                            const isValid = bcrypt.compareSync(password, user.password);
                            if (isValid) {
                                foundUser = user;
                                foundUserId = id;
                                break;
                            }
                        }
                    }

                    // Registration
                    if (!foundUser && isNewUser) {
                        // Check device
                        const existingDevice = Object.entries(users).find(([id, u]) => u.deviceId === deviceId && id !== 'admin');
                        if (existingDevice) {
                            ws.send(JSON.stringify({
                                type: 'auth_failed',
                                data: '❌ This device already has an account. Please login with your existing credentials.'
                            }));
                            return;
                        }
                        // Create user
                        const newUserId = generateUserId();
                        const hashedPassword = bcrypt.hashSync(password, 10);
                        const newUser = {
                            username,
                            password: hashedPassword,
                            role: 'user',
                            created: new Date().toISOString(),
                            deviceId
                        };
                        users[newUserId] = newUser;
                        saveUsers(users);
                        const trials = getTrials();
                        trials[newUserId] = { used: 0, total: 5, expiry: null };
                        saveTrials(trials);
                        foundUser = newUser;
                        foundUserId = newUserId;
                    }
                }

                if (foundUser && foundUserId) {
                    userId = foundUserId;
                    authenticated = true;
                    const token = jwt.sign(
                        { userId, username: foundUser.username, role: foundUser.role || 'user' },
                        process.env.JWT_SECRET || 'your-secret-key',
                        { expiresIn: '24h' }
                    );
                    clients.set(userId, { ws, user: foundUser, token, pingInterval });

                    if (!foundUser.deviceId && deviceId && userId !== 'admin') {
                        users[userId].deviceId = deviceId;
                        saveUsers(users);
                    }

                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        data: {
                            userId,
                            username: foundUser.username,
                            role: foundUser.role || 'user',
                            token,
                            trials: getUserTrials(userId),
                            isNewUser: !foundUser.created || false
                        }
                    }));

                    if (userId !== 'admin') {
                        const adminWs = clients.get('admin');
                        if (adminWs) {
                            adminWs.ws.send(JSON.stringify({
                                type: 'user_login',
                                data: { userId, username: foundUser.username, time: new Date().toISOString(), isNew: !foundUser.created }
                            }));
                        }
                    }
                    const messages = getMessages();
                    messages.forEach(msg => ws.send(JSON.stringify({ type: 'history', data: msg })));
                } else {
                    ws.send(JSON.stringify({ type: 'auth_failed', data: 'Invalid credentials.' }));
                }
                return;
            }

            // next_line for reading
            if (data.type === 'next_line') {
                if (readingStates[userId] && readingStates[userId].active) {
                    readNextLine(userId);
                }
                return;
            }

            if (!authenticated || !userId) {
                ws.send(JSON.stringify({ type: 'error', data: 'Please authenticate first' }));
                return;
            }
            if (userId !== 'admin' && !hasTrialAvailable(userId)) {
                ws.send(JSON.stringify({
                    type: 'trial_expired',
                    data: {
                        message: 'You have used all your free trials. Please upgrade.',
                        upgradeInfo: {
                            price: 'K500',
                            methods: [
                                { provider: 'TNM Mpamba', number: '0891011842' },
                                { provider: 'Airtel Money', number: '0985280353' }
                            ],
                            adminWhatsApp: '0899128441'
                        }
                    }
                }));
                return;
            }

            await handleCommand(data.command, data.args, ws, userId);
            if (userId !== 'admin' && !['.myid', '.assist', '.developer', '.upgrade', '.trials', '.deviceid', '.system'].includes(data.command)) {
                useTrial(userId);
            }

        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ type: 'error', data: 'Error processing request' }));
        }
    });

    ws.on('close', () => {
        clearInterval(pingInterval);
        if (userId) {
            clients.delete(userId);
            delete readingStates[userId];
            console.log(`User ${userId} disconnected`);
        }
    });
});

// ============================================================
// COMMAND HANDLERS
// ============================================================
async function handleCommand(command, args, ws, userId) {
    switch (command) {
        case '.myid': handleMyId(ws, userId); break;
        case '.deviceid': handleDeviceId(ws, userId); break;
        case '.weather': await handleWeather(args, ws); break;
        case '.news': await handleNews(args, ws); break;
        case '.read': handleRead(ws); break;
        case '.me': handleMe(args, ws, userId); break;
        case '.system': await handleSystem(args, ws, userId); break;
        case '.assist': handleAssist(ws, userId); break;
        case '.developer': handleDeveloper(ws); break;
        case '.tune': await handleTune(args, ws); break;
        case '.shot': await handleShot(args, ws, userId); break;
        case '.trace': await handleTrace(args, ws); break;
        case '.upgrade': await handleUpgrade(args, ws, userId); break;
        case '.trials': handleTrials(ws, userId); break;
        default:
            ws.send(JSON.stringify({ type: 'error', data: 'Unknown command. Type .assist for help' }));
    }
}

// ---- .myid ----
function handleMyId(ws, userId) {
    const users = getUsers();
    const user = users[userId];
    const trials = getUserTrials(userId);
    ws.send(JSON.stringify({
        type: 'myid',
        data: {
            userId,
            username: user ? user.username : 'Unknown',
            role: user ? user.role : 'user',
            trials,
            isPremium: trials.expiry ? new Date(trials.expiry) > new Date() : false
        }
    }));
}

// ---- .deviceid ----
function handleDeviceId(ws, userId) {
    const users = getUsers();
    const user = users[userId];
    ws.send(JSON.stringify({
        type: 'deviceid',
        data: {
            deviceId: user?.deviceId || 'Not set',
            message: 'This is your device identifier. It prevents multiple accounts on the same device.'
        }
    }));
}

// ---- .weather (unchanged) ----
async function handleWeather(args, ws) {
    const city = args || 'Lilongwe';
    try {
        let apiKey = process.env.WEATHER_API_KEY;
        if (!apiKey || apiKey === 'your_openweather_api_key_here') {
            const mock = generateMockWeather(city);
            ws.send(JSON.stringify({ type: 'weather', data: { city, forecast: mock, note: '⚠️ Using sample data.' } }));
            return;
        }
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${apiKey}&cnt=40`,
            { timeout: 10000 }
        );
        const dailyForecasts = {};
        response.data.list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const key = date.toDateString();
            if (!dailyForecasts[key]) {
                dailyForecasts[key] = { date, temps: [], descriptions: [], humidities: [], icons: [], windSpeeds: [], feelsLike: [] };
            }
            dailyForecasts[key].temps.push(item.main.temp);
            dailyForecasts[key].descriptions.push(item.weather[0].description);
            dailyForecasts[key].humidities.push(item.main.humidity);
            dailyForecasts[key].icons.push(item.weather[0].icon);
            dailyForecasts[key].windSpeeds.push(item.wind.speed);
            dailyForecasts[key].feelsLike.push(item.main.feels_like);
        });
        const forecast = Object.values(dailyForecasts).slice(0, 5).map(day => {
            const descCount = {};
            day.descriptions.forEach(d => descCount[d] = (descCount[d] || 0) + 1);
            const mainDesc = Object.keys(descCount).reduce((a, b) => descCount[a] > descCount[b] ? a : b);
            const iconCount = {};
            day.icons.forEach(i => iconCount[i] = (iconCount[i] || 0) + 1);
            const mainIcon = Object.keys(iconCount).reduce((a, b) => iconCount[a] > iconCount[b] ? a : b);
            return {
                date: day.date,
                temp_min: Math.round(Math.min(...day.temps)),
                temp_max: Math.round(Math.max(...day.temps)),
                temp_avg: Math.round(day.temps.reduce((a, b) => a + b, 0) / day.temps.length),
                description: mainDesc,
                icon: mainIcon,
                humidity: Math.round(day.humidities.reduce((a, b) => a + b, 0) / day.humidities.length),
                windSpeed: Math.round(day.windSpeeds.reduce((a, b) => a + b, 0) / day.windSpeeds.length * 10) / 10,
                feelsLike: Math.round(day.feelsLike.reduce((a, b) => a + b, 0) / day.feelsLike.length)
            };
        });
        ws.send(JSON.stringify({ type: 'weather', data: { city: response.data.city.name, country: response.data.city.country, forecast } }));
    } catch (error) {
        const mock = generateMockWeather(city);
        ws.send(JSON.stringify({ type: 'weather', data: { city, forecast: mock, note: `⚠️ API error: ${error.message}` } }));
    }
}
function generateMockWeather(city) {
    const conditions = [
        { desc: '☀️ Sunny', icon: '01d' },
        { desc: '⛅ Partly Cloudy', icon: '02d' },
        { desc: '☁️ Cloudy', icon: '03d' },
        { desc: '🌧️ Light Rain', icon: '10d' },
        { desc: '🌤️ Clear', icon: '01d' },
        { desc: '🌦️ Showers', icon: '09d' },
        { desc: '⛈️ Thunderstorm', icon: '11d' },
        { desc: '🌨️ Snow', icon: '13d' }
    ];
    const today = new Date();
    return Array(5).fill(null).map((_, i) => {
        const date = new Date(today);
        date.setDate(date.getDate() + i);
        const condition = conditions[Math.floor(Math.random() * conditions.length)];
        return {
            date,
            temp_min: Math.round(18 + Math.random() * 5),
            temp_max: Math.round(25 + Math.random() * 7),
            temp_avg: Math.round(22 + Math.random() * 5),
            description: condition.desc,
            icon: condition.icon,
            humidity: Math.round(55 + Math.random() * 30),
            windSpeed: Math.round((5 + Math.random() * 15) * 10) / 10,
            feelsLike: Math.round(20 + Math.random() * 8)
        };
    });
}

// ---- .news (RSS version) ----
async function handleNews(args, ws) {
    const category = args || 'global';
    let feedUrl = '';
    let feedName = '';

    if (category === 'malawi') {
        feedUrl = 'https://news.google.com/rss?hl=en-US&gl=MW&ceid=MW:en';
        feedName = 'Malawi News (Google)';
    } else {
        feedUrl = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';
        feedName = 'Global News (Google)';
    }

    ws.send(JSON.stringify({
        type: 'news_progress',
        data: `⏳ Fetching ${category} news from RSS...`
    }));

    try {
        console.log(`📰 Fetching RSS feed: ${feedUrl}`);
        const feed = await parser.parseURL(feedUrl);

        if (!feed.items || feed.items.length === 0) {
            throw new Error('No items in feed');
        }

        // Shuffle and pick up to 8 articles
        const shuffled = feed.items.sort(() => Math.random() - 0.5);
        const count = Math.min(4 + Math.floor(Math.random() * 5), shuffled.length);
        const selected = shuffled.slice(0, count);

        const articles = selected.map(item => ({
            title: item.title || 'No title',
            description: item.contentSnippet || item.content || 'No description',
            source: item.source?.title || item.creator || 'News Source',
            url: item.link || '#',
            image: null, // Google RSS doesn't provide images
            publishedAt: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Recent',
            author: item.author || 'Unknown'
        }));

        ws.send(JSON.stringify({
            type: 'news',
            data: {
                category: category,
                articles: articles,
                total: articles.length,
                note: `📰 ${feedName} (RSS)`
            }
        }));
    } catch (error) {
        console.error('RSS fetch error:', error.message);
        // Fallback to mock data
        const mock = generateMockNews(category);
        ws.send(JSON.stringify({
            type: 'news',
            data: {
                category,
                articles: mock,
                total: mock.length,
                note: `⚠️ RSS feed failed (${error.message}). Using sample data.`
            }
        }));
    }
}

// ---- Mock news (fallback) ----
function generateMockNews(category) {
    const globalPool = [
        { title: 'Global Economy Shows Strong Recovery Signs', description: 'World markets respond positively to economic indicators as GDP growth exceeds expectations in major economies.', source: 'World News Network', author: 'Financial Desk' },
        { title: 'Scientists Announce Clean Energy Breakthrough', description: 'Revolutionary solar technology promises to triple energy efficiency while reducing costs by 40%.', source: 'Tech Today', author: 'Science Team' },
        { title: 'Climate Summit Yields Historic Agreement', description: 'World leaders commit to ambitious carbon reduction targets with developing nations receiving financial support.', source: 'Environment Daily', author: 'Climate Correspondent' },
        { title: 'Healthcare Innovation Accelerates Globally', description: 'AI-powered diagnostic tools and personalized medicine are transforming patient care worldwide.', source: 'Health News', author: 'Medical Editor' },
        { title: 'Space Exploration Reaches New Milestones', description: 'NASA and private companies collaborate on lunar bases and Mars missions.', source: 'Space Today', author: 'Astronomy Desk' },
        { title: 'Artificial Intelligence Regulation Debate Intensifies', description: 'Governments worldwide discuss frameworks to govern AI development and usage.', source: 'Tech Policy', author: 'Policy Analyst' },
        { title: 'Global Education Reform Initiatives', description: 'UNESCO announces new programs to improve access to quality education in developing countries.', source: 'Education World', author: 'Education Correspondent' },
        { title: 'Renewable Energy Investments Surge', description: 'Solar and wind power projects attract record investments as fossil fuel prices rise.', source: 'Energy News', author: 'Energy Reporter' }
    ];
    const malawiPool = [
        { title: 'Malawi Agriculture Transformation Underway', description: 'New farming techniques and irrigation systems boost crop yields by 30% in central region.', source: 'Malawi Times', author: 'Agriculture Reporter' },
        { title: 'Lake Malawi Conservation Success Story', description: 'Community-led initiatives restore fish populations and protect aquatic biodiversity in the lake.', source: 'Nature Malawi', author: 'Environment Journalist' },
        { title: 'Digital Education Revolution in Malawi', description: 'Government partners with tech companies to provide tablets and online learning to rural schools.', source: 'Education Weekly', author: 'Education Desk' },
        { title: 'Malawi Infrastructure Development Accelerates', description: 'New road networks and renewable energy projects create thousands of jobs and improve connectivity.', source: 'Malawi Development', author: 'Development Correspondent' },
        { title: 'Malawi Tourism Industry Bounces Back', description: 'Lake Malawi and wildlife reserves attract more international visitors after pandemic slowdown.', source: 'Travel Malawi', author: 'Tourism Writer' },
        { title: 'Malawi Health Sector Receives Funding Boost', description: 'International donors pledge $50 million to improve healthcare facilities and training.', source: 'Health Malawi', author: 'Health Editor' },
        { title: 'Malawi Youth Entrepreneurship Program Launched', description: 'New initiative provides grants and mentorship to young entrepreneurs in tech and agriculture.', source: 'Business Malawi', author: 'Business Reporter' },
        { title: 'Malawi President Announces New Education Policy', description: 'Reforms aim to increase access to secondary education and vocational training.', source: 'Malawi News', author: 'Political Correspondent' }
    ];
    const pool = category === 'malawi' ? malawiPool : globalPool;
    const shuffled = pool.sort(() => Math.random() - 0.5);
    const count = Math.min(4 + Math.floor(Math.random() * 3), shuffled.length);
    const selected = shuffled.slice(0, count);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return selected.map(article => ({ ...article, image: null, publishedAt: today }));
}

// ---- .read (unchanged) ----
function handleRead(ws) {
    ws.send(JSON.stringify({ type: 'read_prompt', data: '📄 Please upload a PDF or text document to read aloud' }));
}
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    let content = '';
    if (fileExt === '.txt') {
        try { content = fs.readFileSync(filePath, 'utf8'); } catch (e) { content = `Error reading file: ${e.message}`; }
    } else {
        content = `📄 Document: ${req.file.originalname}\nFile type: ${fileExt}\nFile size: ${(req.file.size / 1024).toFixed(2)} KB`;
    }
    const lines = content.split('\n');
    global.readFile = {
        lines,
        currentIndex: 0,
        filePath,
        filename: req.file.originalname,
        totalLines: lines.length
    };
    res.json({ message: `📄 File "${req.file.originalname}" uploaded successfully. Starting to read aloud...`, totalLines: lines.length });
});
app.post('/read/control', (req, res) => {
    const { action, userId } = req.body;
    if (action === 'start') {
        if (!global.readFile) return res.status(400).json({ error: 'No file uploaded.' });
        readingStates[userId] = {
            active: true,
            lines: global.readFile.lines,
            currentIndex: 0,
            filename: global.readFile.filename
        };
        readNextLine(userId);
        res.json({ message: '📖 Started reading document aloud' });
    } else if (action === 'stop') {
        if (readingStates[userId]) {
            readingStates[userId].active = false;
            delete readingStates[userId];
        }
        res.json({ message: '⏹️ Stopped reading' });
    }
});
function readNextLine(userId) {
    const state = readingStates[userId];
    if (!state || !state.active) return;
    if (state.currentIndex >= state.lines.length) {
        state.active = false;
        const client = clients.get(userId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ type: 'read_complete', data: '✅ Finished reading the entire document' }));
        }
        return;
    }
    const line = state.lines[state.currentIndex++];
    const client = clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
            type: 'read_line',
            data: { lineNumber: state.currentIndex, totalLines: state.lines.length, content: line || ' ', filename: state.filename }
        }));
    }
}

// ---- .me (fixed broadcast) ----
function handleMe(args, ws, userId) {
    const message = args || 'Hello everyone!';
    const users = getUsers();
    const user = users[userId];
    const publicMessage = {
        userId,
        username: user ? user.username : 'Unknown',
        message,
        timestamp: new Date().toISOString(),
        type: 'text'
    };
    const messages = getMessages();
    messages.push(publicMessage);
    saveMessages(messages);
    broadcastMessage(null, publicMessage);
    ws.send(JSON.stringify({ type: 'confirm', data: '✅ Message sent to everyone' }));
}

// ---- .system (admin broadcast) ----
async function handleSystem(args, ws, userId) {
    const users = getUsers();
    const user = users[userId];
    if (!user || user.role !== 'admin') {
        ws.send(JSON.stringify({ type: 'error', data: '❌ Admin only command.' }));
        return;
    }
    if (!args) {
        ws.send(JSON.stringify({ type: 'error', data: 'Usage: .system <message>' }));
        return;
    }
    const systemMessage = {
        type: 'system_broadcast',
        message: args,
        timestamp: new Date().toISOString(),
        sender: 'Admin'
    };
    broadcastMessage(null, systemMessage);
    ws.send(JSON.stringify({ type: 'confirm', data: '✅ System message sent to all users.' }));
}

// ---- .assist ----
function handleAssist(ws, userId) {
    const commands = [
        { command: '.myid', description: 'Show your unique user ID and trial status' },
        { command: '.deviceid', description: 'Show your device identifier' },
        { command: '.weather [city]', description: 'Predict next 5 days weather (default: Lilongwe)' },
        { command: '.news [global/malawi]', description: 'Show trending global or Malawi news (RSS)' },
        { command: '.read', description: 'Upload and read document aloud line by line' },
        { command: '.me [message]', description: 'Send public message to everyone logged in' },
        { command: '.assist', description: 'Display all commands and how to use' },
        { command: '.developer', description: 'Show developer information' },
        { command: '.tune [passage]', description: 'Rewrite AI-generated text in human form' },
        { command: '.shot [fb link]', description: 'Download video from Facebook via downloader links' },
        { command: '.trace [ip/domain]', description: 'Trace IP address or domain location (leave empty for your own IP)' },
        { command: '.trials', description: 'Check your remaining free trials' }
    ];
    const users = getUsers();
    if (users[userId] && users[userId].role === 'admin') {
        commands.push({ command: '.upgrade [userID] [days]', description: 'Upgrade a user to premium (Admin only)' });
        commands.push({ command: '.system <message>', description: 'Send a system-wide announcement (Admin only)' });
    }
    let helpText = '🤖 Available Commands:\n\n';
    commands.forEach(cmd => helpText += `📌 ${cmd.command}\n   ${cmd.description}\n\n`);
    ws.send(JSON.stringify({ type: 'help', data: helpText }));
}

// ---- .developer ----
function handleDeveloper(ws) {
    const info = {
        name: 'Emmanuel Chimombo',
        education: 'Mzuzu University',
        program: 'ICT Student',
        year: 'Current Student',
        skills: ['Web Development', 'Bot Development', 'AI Integration']
    };
    ws.send(JSON.stringify({ type: 'developer', data: info }));
}

// ---- .tune ----
async function handleTune(args, ws) {
    if (!args) {
        ws.send(JSON.stringify({ type: 'error', data: 'Please provide text to tune.' }));
        return;
    }
    try {
        const humanized = humanizeText(args);
        ws.send(JSON.stringify({ type: 'tune', data: { original: args, humanized } }));
    } catch (error) {
        ws.send(JSON.stringify({ type: 'error', data: 'Error tuning text.' }));
    }
}
function humanizeText(text) {
    let h = text;
    h = h.replace(/in conclusion/gi, '');
    h = h.replace(/furthermore/gi, '');
    h = h.replace(/additionally/gi, '');
    h = h.replace(/it is important to note that/gi, '');
    h = h.replace(/AI/gi, 'technology');
    h = h.replace(/machine learning/gi, 'smart algorithms');
    h = h.replace(/do not/g, 'don\'t');
    h = h.replace(/cannot/g, 'can\'t');
    h = h.replace(/will not/g, 'won\'t');
    h = h.replace(/is not/g, 'isn\'t');
    h = h.replace(/are not/g, 'aren\'t');
    return h;
}

// ---- .shot ----
async function handleShot(args, ws, userId) {
    if (!args || !args.startsWith('http')) {
        ws.send(JSON.stringify({ type: 'error', data: '❌ Please provide a valid Facebook video link.' }));
        return;
    }
    if (!args.includes('facebook.com') && !args.includes('fb.watch')) {
        ws.send(JSON.stringify({ type: 'error', data: '❌ Please provide a valid Facebook video link only.' }));
        return;
    }
    ws.send(JSON.stringify({ type: 'shot_progress', data: '⏳ Processing Facebook video link...' }));
    try {
        let videoId = null;
        let videoUrl = args;
        const patterns = [/\/videos\/(\d+)/, /\/watch\?v=(\d+)/, /\/share\/v\/([^\/]+)/, /\/reel\/(\d+)/];
        for (const p of patterns) {
            const m = args.match(p);
            if (m) { videoId = m[1]; break; }
        }
        if (videoId) videoUrl = `https://www.facebook.com/watch?v=${videoId}`;
        const downloadLinks = [
            { name: '🔗 Snapsave (Recommended)', url: `https://snapsave.app/`, instructions: `1. Go to snapsave.app\n2. Paste this URL: ${videoUrl}\n3. Click Download` },
            { name: '🔗 FB Down', url: `https://fbdown.net/`, instructions: `1. Go to fbdown.net\n2. Paste this URL: ${videoUrl}\n3. Click Download` },
            { name: '🔗 GetFvid', url: `https://getfvid.com/`, instructions: `1. Go to getfvid.com\n2. Paste this URL: ${videoUrl}\n3. Click Download` },
            { name: '🔗 SaveFrom.net', url: `https://en.savefrom.net/`, instructions: `1. Go to savefrom.net\n2. Paste this URL: ${videoUrl}\n3. Click Download` }
        ];
        ws.send(JSON.stringify({
            type: 'shot_success',
            data: {
                message: '✅ Facebook video link processed!',
                videoId: videoId || 'Unknown',
                videoUrl,
                downloadLinks,
                note: '📥 Click any link below to download the video:',
                instruction: '💡 If the downloader doesn\'t work, try a different one.'
            }
        }));
    } catch (error) {
        ws.send(JSON.stringify({ type: 'error', data: `❌ Error: ${error.message}` }));
    }
}

// ---- .trace ----
async function handleTrace(args, ws) {
    const query = args ? args.trim() : '';
    ws.send(JSON.stringify({ type: 'trace_progress', data: query ? `⏳ Tracing IP: ${query}...` : '⏳ Tracing your current IP...' }));
    try {
        let apiUrl = 'http://ip-api.com/json/';
        if (query) {
            const valid = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(query) || /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/.test(query);
            if (!valid) {
                ws.send(JSON.stringify({ type: 'error', data: '❌ Invalid IP or domain.' }));
                return;
            }
            apiUrl += encodeURIComponent(query);
        }
        apiUrl += '?fields=status,message,query,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting';
        const response = await axios.get(apiUrl, { timeout: 10000 });
        const data = response.data;
        if (data.status === 'fail') {
            ws.send(JSON.stringify({ type: 'error', data: `❌ Trace failed: ${data.message}` }));
            return;
        }
        const result = {
            query: data.query || query || 'Unknown',
            country: data.country || 'N/A',
            countryCode: data.countryCode || 'N/A',
            region: data.regionName || data.region || 'N/A',
            city: data.city || 'N/A',
            zip: data.zip || 'N/A',
            lat: data.lat || 'N/A',
            lon: data.lon || 'N/A',
            timezone: data.timezone || 'N/A',
            isp: data.isp || 'N/A',
            org: data.org || 'N/A',
            as: data.as || 'N/A',
            asname: data.asname || 'N/A',
            mobile: data.mobile !== undefined ? (data.mobile ? 'Yes' : 'No') : 'N/A',
            proxy: data.proxy !== undefined ? (data.proxy ? 'Yes' : 'No') : 'N/A',
            hosting: data.hosting !== undefined ? (data.hosting ? 'Yes' : 'No') : 'N/A'
        };
        ws.send(JSON.stringify({ type: 'trace_success', data: result }));
    } catch (error) {
        ws.send(JSON.stringify({ type: 'error', data: `❌ Trace failed: ${error.message}` }));
    }
}

// ---- .upgrade (admin) ----
async function handleUpgrade(args, ws, userId) {
    const users = getUsers();
    const currentUser = users[userId];
    if (!currentUser || currentUser.role !== 'admin') {
        ws.send(JSON.stringify({ type: 'error', data: '❌ Admin only.' }));
        return;
    }
    if (!args) {
        ws.send(JSON.stringify({ type: 'error', data: 'Usage: .upgrade [userID] [days]' }));
        return;
    }
    const parts = args.split(' ');
    const targetUserId = parts[0];
    const days = parseInt(parts[1]);
    if (!targetUserId || !days || days <= 0) {
        ws.send(JSON.stringify({ type: 'error', data: 'Invalid parameters.' }));
        return;
    }
    if (!users[targetUserId]) {
        ws.send(JSON.stringify({ type: 'error', data: `❌ User ${targetUserId} not found` }));
        return;
    }
    const trials = getTrials();
    if (!trials[targetUserId]) trials[targetUserId] = { used: 0, total: 5, expiry: null };
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    trials[targetUserId].expiry = expiry.toISOString();
    trials[targetUserId].total = 999;
    saveTrials(trials);
    ws.send(JSON.stringify({
        type: 'upgrade_success',
        data: { userId: targetUserId, username: users[targetUserId].username, days, expiry: expiry.toISOString() }
    }));
    const client = clients.get(targetUserId);
    if (client) {
        client.ws.send(JSON.stringify({
            type: 'upgraded',
            data: { message: `🎉 Your account has been upgraded to premium for ${days} days!`, expiry: expiry.toISOString() }
        }));
    }
}

// ---- .trials ----
function handleTrials(ws, userId) {
    const trials = getUserTrials(userId);
    const users = getUsers();
    const user = users[userId];
    const isPremium = trials.expiry ? new Date(trials.expiry) > new Date() : false;
    let msg = `📊 Trial Information\n\n`;
    msg += `User ID: ${userId}\nUsername: ${user ? user.username : 'Unknown'}\n`;
    msg += `Trials Used: ${trials.used}/${trials.total}\nStatus: ${isPremium ? '✅ PREMIUM' : '🆓 Free User'}\n`;
    if (isPremium) {
        const daysLeft = Math.ceil((new Date(trials.expiry) - new Date()) / (1000*60*60*24));
        msg += `Premium Expiry: ${new Date(trials.expiry).toLocaleDateString()} (${daysLeft} days left)\n`;
    } else {
        const remaining = trials.total - trials.used;
        msg += `Remaining Free Trials: ${remaining}\n`;
        if (remaining === 0) {
            msg += `\n⚠️ You have used all free trials!\nUpgrade: K500 via TNM Mpamba (0891011842) or Airtel Money (0985280353)\nAfter payment, send confirmation + your ID to admin on WhatsApp: 0899128441`;
        }
    }
    ws.send(JSON.stringify({ type: 'trials_info', data: msg }));
}

// ---- Broadcast ----
function broadcastMessage(targetUserId, message) {
    const payload = JSON.stringify({ type: 'public', data: message });
    if (targetUserId) {
        const client = clients.get(targetUserId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(payload);
        }
    } else {
        clients.forEach((client) => {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(payload);
            }
        });
    }
}

// ---- Static & Start ----
app.use('/downloads', express.static(DOWNLOADS_PATH));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (req, res) => res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/debug-env', (req, res) => {
    const env = {
        WEATHER_API_KEY: process.env.WEATHER_API_KEY ? '✅ Set' : '❌ Missing',
        JWT_SECRET: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
        DB_PATH: process.env.DB_PATH || 'Not set',
        NODE_ENV: process.env.NODE_ENV || 'Not set',
        PORT: process.env.PORT || 'Not set'
    };
    res.json({ status: 'OK', environment: env });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Bot server running on http://localhost:${PORT}`);
    console.log(`✅ WebSocket running on ws://localhost:${PORT}`);
    console.log(`✅ RSS News active – no API key required!`);
});
