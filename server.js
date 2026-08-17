// server.js - COMPLETE UPDATED FILE
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
const fbDownloader = require('fb-downloader');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Log environment variables status
console.log('\n🔍 Environment Check:');
console.log(`🌤️ WEATHER_API_KEY: ${process.env.WEATHER_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`📰 NEWS_API_KEY: ${process.env.NEWS_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`🔑 JWT_SECRET: ${process.env.JWT_SECRET ? '✅ Set' : '❌ Missing'}`);
console.log(`📁 DB_PATH: ${process.env.DB_PATH || '/tmp/data'}\n`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database file paths
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');
const TRIALS_FILE = path.join(DB_PATH, 'trials.json');
const MESSAGES_FILE = path.join(DB_PATH, 'messages.json');
const DOWNLOADS_PATH = path.join(DB_PATH, 'downloads');

// Ensure directories exist
if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_PATH)) {
    fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
}

// Initialize database
function initDB() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            const defaultUsers = {
                admin: {
                    username: 'blessed',
                    password: bcrypt.hashSync('emmanuel', 10),
                    role: 'admin',
                    created: new Date().toISOString()
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

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `doc_${Date.now()}_${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Store connected clients
const clients = new Map();

// User management functions
function getUsers() {
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (error) {
        console.error('Error reading users:', error);
        return { admin: { username: 'blessed', password: bcrypt.hashSync('emmanuel', 10), role: 'admin' } };
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getTrials() {
    try {
        return JSON.parse(fs.readFileSync(TRIALS_FILE, 'utf8'));
    } catch (error) {
        return {};
    }
}

function saveTrials(trials) {
    fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials, null, 2));
}

function getMessages() {
    try {
        return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
    } catch (error) {
        return [];
    }
}

function saveMessages(messages) {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function generateUserId() {
    const users = getUsers();
    const userIds = Object.keys(users).filter(key => key !== 'admin');
    if (userIds.length === 0) return 'USER001';
    
    const maxId = userIds.reduce((max, id) => {
        const num = parseInt(id.replace('USER', ''));
        return num > max ? num : max;
    }, 0);
    
    return `USER${String(maxId + 1).padStart(3, '0')}`;
}

function getUserTrials(userId) {
    const trials = getTrials();
    return trials[userId] || { used: 0, total: 5, expiry: null };
}

function hasTrialAvailable(userId) {
    const userTrials = getUserTrials(userId);
    if (userTrials.expiry) {
        return new Date(userTrials.expiry) > new Date();
    }
    return userTrials.used < userTrials.total;
}

function useTrial(userId) {
    const trials = getTrials();
    if (!trials[userId]) {
        trials[userId] = { used: 0, total: 5, expiry: null };
    }
    
    if (trials[userId].expiry) {
        return true;
    }
    
    if (trials[userId].used < trials[userId].total) {
        trials[userId].used++;
        saveTrials(trials);
        return true;
    }
    return false;
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
    let userId = null;
    let authenticated = false;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                const { username, password, isNewUser } = data;
                const users = getUsers();
                
                let foundUser = null;
                let foundUserId = null;
                
                // Check if trying to register as admin
                if (username === 'blessed') {
                    const isValid = bcrypt.compareSync(password, users.admin.password);
                    if (isValid) {
                        foundUser = users.admin;
                        foundUserId = 'admin';
                        foundUser.role = 'admin';
                    } else {
                        ws.send(JSON.stringify({
                            type: 'auth_failed',
                            data: 'Invalid admin credentials'
                        }));
                        return;
                    }
                } else {
                    // Check if user exists
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
                    
                    // If user doesn't exist and isNewUser is true, create new account
                    if (!foundUser && isNewUser) {
                        const newUserId = generateUserId();
                        const hashedPassword = bcrypt.hashSync(password, 10);
                        const newUser = {
                            username: username,
                            password: hashedPassword,
                            role: 'user',
                            created: new Date().toISOString()
                        };
                        users[newUserId] = newUser;
                        saveUsers(users);
                        
                        // Initialize trials for new user
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
                    
                    clients.set(userId, { ws, user: foundUser, token });
                    
                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        data: {
                            userId: userId,
                            username: foundUser.username,
                            role: foundUser.role || 'user',
                            token: token,
                            trials: getUserTrials(userId),
                            isNewUser: !foundUser.created
                        }
                    }));
                    
                    // Notify admin about new user
                    if (userId !== 'admin') {
                        const adminWs = clients.get('admin');
                        if (adminWs) {
                            adminWs.ws.send(JSON.stringify({
                                type: 'user_login',
                                data: {
                                    userId: userId,
                                    username: foundUser.username,
                                    time: new Date().toISOString(),
                                    isNew: !foundUser.created
                                }
                            }));
                        }
                    }
                    
                    // Send message history with files
                    const messages = getMessages();
                    messages.forEach(msg => {
                        ws.send(JSON.stringify({
                            type: 'history',
                            data: msg
                        }));
                    });
                } else {
                    ws.send(JSON.stringify({
                        type: 'auth_failed',
                        data: 'Invalid credentials. Please try again or register.'
                    }));
                }
                return;
            }
            
            if (!authenticated || !userId) {
                ws.send(JSON.stringify({
                    type: 'error',
                    data: 'Please authenticate first'
                }));
                return;
            }
            
            // Check trials for non-admin users
            if (userId !== 'admin') {
                if (!hasTrialAvailable(userId)) {
                    ws.send(JSON.stringify({
                        type: 'trial_expired',
                        data: {
                            message: 'You have used all your free trials. Please upgrade to continue.',
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
            }
            
            await handleCommand(data.command, data.args, ws, userId);
            
            if (userId !== 'admin' && !['.myid', '.assist', '.developer', '.upgrade', '.trials'].includes(data.command)) {
                useTrial(userId);
            }
            
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                data: 'Error processing request'
            }));
        }
    });
    
    ws.on('close', () => {
        if (userId) {
            clients.delete(userId);
            console.log(`User ${userId} disconnected`);
        }
    });
});

// Command handlers
async function handleCommand(command, args, ws, userId) {
    switch(command) {
        case '.myid':
            handleMyId(ws, userId);
            break;
        case '.weather':
            await handleWeather(args, ws);
            break;
        case '.news':
            await handleNews(args, ws);
            break;
        case '.read':
            handleRead(ws);
            break;
        case '.me':
            handleMe(args, ws, userId);
            break;
        case '.assist':
            handleAssist(ws, userId);
            break;
        case '.developer':
            handleDeveloper(ws);
            break;
        case '.tune':
            await handleTune(args, ws);
            break;
        case '.shot':
            await handleShot(args, ws, userId);
            break;
        case '.upgrade':
            await handleUpgrade(args, ws, userId);
            break;
        case '.trials':
            handleTrials(ws, userId);
            break;
        default:
            ws.send(JSON.stringify({
                type: 'error',
                data: 'Unknown command. Type .assist for help'
            }));
    }
}

function handleMyId(ws, userId) {
    const users = getUsers();
    const user = users[userId];
    const trials = getUserTrials(userId);
    
    ws.send(JSON.stringify({
        type: 'myid',
        data: {
            userId: userId,
            username: user ? user.username : 'Unknown',
            role: user ? user.role : 'user',
            trials: trials,
            isPremium: trials.expiry ? new Date(trials.expiry) > new Date() : false
        }
    }));
}

// ============================================
// 🌤️ IMPROVED WEATHER HANDLER
// ============================================
async function handleWeather(args, ws) {
    const city = args || 'Lilongwe';
    
    try {
        let apiKey = process.env.WEATHER_API_KEY;
        
        if (!apiKey || apiKey === 'your_openweather_api_key_here') {
            try {
                const envPath = path.join(__dirname, '.env');
                if (fs.existsSync(envPath)) {
                    const envContent = fs.readFileSync(envPath, 'utf8');
                    const match = envContent.match(/WEATHER_API_KEY=(.+)/);
                    if (match && match[1]) {
                        apiKey = match[1].trim();
                    }
                }
            } catch (err) {
                console.log('Could not read .env file for weather key');
            }
        }
        
        if (!apiKey || apiKey === 'your_openweather_api_key_here' || apiKey === 'your_actual_openweather_api_key_here') {
            console.log('⚠️ No valid Weather API key found, using mock data');
            const mockForecast = generateMockWeather(city);
            ws.send(JSON.stringify({
                type: 'weather',
                data: {
                    city: city,
                    forecast: mockForecast,
                    note: '⚠️ Using sample data. Please add your OpenWeatherMap API key to .env file.'
                }
            }));
            return;
        }
        
        console.log(`🌤️ Fetching weather for ${city}...`);
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${apiKey}&cnt=40`,
            { timeout: 10000 }
        );
        
        // Group forecasts by day
        const dailyForecasts = {};
        response.data.list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const dateKey = date.toDateString();
            
            if (!dailyForecasts[dateKey]) {
                dailyForecasts[dateKey] = {
                    date: date,
                    temps: [],
                    descriptions: [],
                    humidities: [],
                    icons: [],
                    windSpeeds: [],
                    feelsLike: []
                };
            }
            
            dailyForecasts[dateKey].temps.push(item.main.temp);
            dailyForecasts[dateKey].descriptions.push(item.weather[0].description);
            dailyForecasts[dateKey].humidities.push(item.main.humidity);
            dailyForecasts[dateKey].icons.push(item.weather[0].icon);
            dailyForecasts[dateKey].windSpeeds.push(item.wind.speed);
            dailyForecasts[dateKey].feelsLike.push(item.main.feels_like);
        });
        
        // Process each day's data
        const forecast = Object.values(dailyForecasts).slice(0, 5).map(day => {
            // Get most common description
            const descCount = {};
            day.descriptions.forEach(d => descCount[d] = (descCount[d] || 0) + 1);
            const mainDesc = Object.keys(descCount).reduce((a, b) => descCount[a] > descCount[b] ? a : b);
            
            // Get most common icon
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
        
        ws.send(JSON.stringify({
            type: 'weather',
            data: {
                city: response.data.city.name,
                country: response.data.city.country,
                forecast: forecast
            }
        }));
        
    } catch (error) {
        console.error('Weather API Error:', error.message);
        const mockForecast = generateMockWeather(city);
        ws.send(JSON.stringify({
            type: 'weather',
            data: {
                city: city,
                forecast: mockForecast,
                note: `⚠️ Using sample data. API Error: ${error.message}`
            }
        }));
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
            date: date,
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

// ============================================
// 📰 IMPROVED NEWS HANDLER
// ============================================
async function handleNews(args, ws) {
    const category = args || 'global';
    
    try {
        let apiKey = process.env.NEWS_API_KEY;
        
        if (!apiKey || apiKey === 'your_gnews_api_key_here') {
            try {
                const envPath = path.join(__dirname, '.env');
                if (fs.existsSync(envPath)) {
                    const envContent = fs.readFileSync(envPath, 'utf8');
                    const match = envContent.match(/NEWS_API_KEY=(.+)/);
                    if (match && match[1]) {
                        apiKey = match[1].trim();
                    }
                }
            } catch (err) {
                console.log('Could not read .env file for news key');
            }
        }
        
        if (!apiKey || apiKey === 'your_gnews_api_key_here' || apiKey === 'your_actual_gnews_api_key_here') {
            console.log('⚠️ No valid News API key found, using mock data');
            const mockNews = generateMockNews(category);
            ws.send(JSON.stringify({
                type: 'news',
                data: {
                    category: category,
                    articles: mockNews,
                    note: '⚠️ Using sample data. Please add your GNews API key to .env file.'
                }
            }));
            return;
        }
        
        console.log(`📰 Fetching ${category} news...`);
        let url = `https://gnews.io/api/v4/top-headlines?token=${apiKey}&lang=en&max=10`;
        
        if (category === 'malawi') {
            url = `https://gnews.io/api/v4/search?q=malawi&token=${apiKey}&lang=en&max=10`;
        }
        
        const response = await axios.get(url, { timeout: 10000 });
        
        // Process articles with more details
        const articles = response.data.articles.slice(0, 8).map(article => ({
            title: article.title || 'No title',
            description: article.description || 'No description available',
            content: article.content || article.description || 'No content available',
            source: article.source?.name || 'Unknown source',
            url: article.url || '#',
            image: article.image || null,
            publishedAt: article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric',
                year: 'numeric'
            }) : 'Recent',
            author: article.author || 'Unknown'
        }));
        
        ws.send(JSON.stringify({
            type: 'news',
            data: {
                category: category,
                articles: articles,
                total: articles.length
            }
        }));
        
    } catch (error) {
        console.error('News API Error:', error.message);
        const mockNews = generateMockNews(category);
        ws.send(JSON.stringify({
            type: 'news',
            data: {
                category: category,
                articles: mockNews,
                note: `⚠️ Using sample data. API Error: ${error.message}`
            }
        }));
    }
}

function generateMockNews(category) {
    const globalNews = [
        { 
            title: 'Global Economy Shows Strong Recovery Signs', 
            description: 'World markets respond positively to economic indicators as GDP growth exceeds expectations in major economies.', 
            source: 'World News Network',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Financial Desk'
        },
        { 
            title: 'Scientists Announce Clean Energy Breakthrough', 
            description: 'Revolutionary solar technology promises to triple energy efficiency while reducing costs by 40%.', 
            source: 'Tech Today',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Science Team'
        },
        { 
            title: 'Climate Summit Yields Historic Agreement', 
            description: 'World leaders commit to ambitious carbon reduction targets with developing nations receiving financial support.', 
            source: 'Environment Daily',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Climate Correspondent'
        },
        { 
            title: 'Healthcare Innovation Accelerates Globally', 
            description: 'AI-powered diagnostic tools and personalized medicine are transforming patient care worldwide.', 
            source: 'Health News',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Medical Editor'
        }
    ];
    
    const malawiNews = [
        { 
            title: 'Malawi Agriculture Transformation Underway', 
            description: 'New farming techniques and irrigation systems boost crop yields by 30% in central region.', 
            source: 'Malawi Times',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Agriculture Reporter'
        },
        { 
            title: 'Lake Malawi Conservation Success Story', 
            description: 'Community-led initiatives restore fish populations and protect aquatic biodiversity in the lake.', 
            source: 'Nature Malawi',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Environment Journalist'
        },
        { 
            title: 'Digital Education Revolution in Malawi', 
            description: 'Government partners with tech companies to provide tablets and online learning to rural schools.', 
            source: 'Education Weekly',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Education Desk'
        },
        { 
            title: 'Malawi Infrastructure Development Accelerates', 
            description: 'New road networks and renewable energy projects create thousands of jobs and improve connectivity.', 
            source: 'Malawi Development',
            image: null,
            publishedAt: new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            author: 'Development Correspondent'
        }
    ];
    
    return category === 'malawi' ? malawiNews : globalNews;
}

// ============================================
// 📄 READ COMMAND HANDLER
// ============================================
function handleRead(ws) {
    ws.send(JSON.stringify({
        type: 'read_prompt',
        data: '📄 Please upload a PDF or text document to read aloud'
    }));
}

// File upload endpoint for .read command
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    
    let content = '';
    
    if (fileExt === '.txt') {
        try {
            content = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            content = `Error reading file: ${error.message}`;
        }
    } else {
        content = `📄 Document: ${req.file.originalname}\nFile type: ${fileExt}\nFile size: ${(req.file.size / 1024).toFixed(2)} KB`;
    }
    
    const lines = content.split('\n');
    
    global.readFile = {
        lines: lines,
        currentIndex: 0,
        filePath: filePath,
        filename: req.file.originalname,
        totalLines: lines.length
    };
    
    res.json({
        message: `📄 File "${req.file.originalname}" uploaded successfully. Starting to read aloud...`,
        totalLines: lines.length
    });
});

app.post('/read/control', (req, res) => {
    const { action, userId } = req.body;
    
    if (action === 'start') {
        if (!global.readFile) {
            return res.status(400).json({ error: 'No file uploaded. Please upload a document first.' });
        }
        
        global.readingActive = true;
        readNextLine(userId);
        res.json({ message: '📖 Started reading document aloud' });
    } else if (action === 'stop') {
        global.readingActive = false;
        if (global.readTimeout) {
            clearTimeout(global.readTimeout);
            global.readTimeout = null;
        }
        res.json({ message: '⏹️ Stopped reading' });
    }
});

function readNextLine(userId) {
    if (!global.readingActive || !global.readFile) return;
    
    const file = global.readFile;
    if (file.currentIndex < file.lines.length) {
        const line = file.lines[file.currentIndex];
        file.currentIndex++;
        
        const client = clients.get(userId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'read_line',
                data: {
                    lineNumber: file.currentIndex,
                    totalLines: file.lines.length,
                    content: line || ' ',
                    filename: file.filename
                }
            }));
        }
        
        global.readTimeout = setTimeout(() => readNextLine(userId), 1500);
    } else {
        global.readingActive = false;
        const client = clients.get(userId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
                type: 'read_complete',
                data: '✅ Finished reading the entire document'
            }));
        }
    }
}

// ============================================
// 💬 PUBLIC MESSAGE HANDLER
// ============================================
function handleMe(args, ws, userId) {
    const message = args || 'Hello everyone!';
    const users = getUsers();
    const user = users[userId];
    
    const publicMessage = {
        userId: userId,
        username: user ? user.username : 'Unknown',
        message: message,
        timestamp: new Date().toISOString(),
        type: 'text'
    };
    
    const messages = getMessages();
    messages.push(publicMessage);
    saveMessages(messages);
    
    broadcastMessage(null, publicMessage);
    
    ws.send(JSON.stringify({
        type: 'confirm',
        data: '✅ Message sent to everyone'
    }));
}

function handleAssist(ws, userId) {
    const commands = [
        { command: '.myid', description: 'Show your unique user ID and trial status' },
        { command: '.weather [city]', description: 'Predict next 5 days weather (default: Lilongwe)' },
        { command: '.news [global/malawi]', description: 'Show trending global or Malawi news' },
        { command: '.read', description: 'Upload and read document aloud line by line' },
        { command: '.me [message]', description: 'Send public message to everyone logged in' },
        { command: '.assist', description: 'Display all commands and how to use' },
        { command: '.developer', description: 'Show developer information' },
        { command: '.tune [passage]', description: 'Rewrite AI-generated text in human form' },
        { command: '.shot [fb link]', description: 'Download video from Facebook (Automatic download)' },
        { command: '.trials', description: 'Check your remaining free trials' }
    ];
    
    const users = getUsers();
    if (users[userId] && users[userId].role === 'admin') {
        commands.push({ command: '.upgrade [userID] [days]', description: 'Upgrade a user to premium (Admin only)' });
    }
    
    let helpText = '🤖 Available Commands:\n\n';
    commands.forEach(cmd => {
        helpText += `📌 ${cmd.command}\n   ${cmd.description}\n\n`;
    });
    
    ws.send(JSON.stringify({
        type: 'help',
        data: helpText
    }));
}

function handleDeveloper(ws) {
    const info = {
        name: 'Emmanuel Chimombo',
        education: 'Mzuzu University',
        program: 'ICT Student',
        year: 'Current Student',
        skills: ['Web Development', 'Bot Development', 'AI Integration']
    };
    
    ws.send(JSON.stringify({
        type: 'developer',
        data: info
    }));
}

// ============================================
// 🔄 TUNE COMMAND HANDLER
// ============================================
async function handleTune(args, ws) {
    if (!args) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Please provide text to tune. Example: .tune "Your AI-generated text here"'
        }));
        return;
    }
    
    try {
        const humanizedText = humanizeText(args);
        
        ws.send(JSON.stringify({
            type: 'tune',
            data: {
                original: args,
                humanized: humanizedText
            }
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Error tuning text. Please try again.'
        }));
    }
}

function humanizeText(text) {
    let humanized = text;
    humanized = humanized.replace(/in conclusion/gi, '');
    humanized = humanized.replace(/furthermore/gi, '');
    humanized = humanized.replace(/additionally/gi, '');
    humanized = humanized.replace(/it is important to note that/gi, '');
    humanized = humanized.replace(/AI/gi, 'technology');
    humanized = humanized.replace(/machine learning/gi, 'smart algorithms');
    humanized = humanized.replace(/do not/g, 'don\'t');
    humanized = humanized.replace(/cannot/g, 'can\'t');
    humanized = humanized.replace(/will not/g, 'won\'t');
    humanized = humanized.replace(/is not/g, 'isn\'t');
    humanized = humanized.replace(/are not/g, 'aren\'t');
    return humanized;
}

// ============================================
// 🎬 IMPROVED .SHOT COMMAND - Multiple Download Methods
// ============================================
async function handleShot(args, ws, userId) {
    // Validate URL
    if (!args || !args.startsWith('http')) {
        ws.send(JSON.stringify({
            type: 'error',
            data: '❌ Please provide a valid Facebook video link.\nExample: .shot https://www.facebook.com/.../videos/...'
        }));
        return;
    }
    
    // Check if it's a Facebook URL
    if (!args.includes('facebook.com') && !args.includes('fb.watch')) {
        ws.send(JSON.stringify({
            type: 'error',
            data: '❌ Please provide a valid Facebook video link only.'
        }));
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'shot_progress',
        data: '⏳ Fetching Facebook video... Please wait...'
    }));
    
    try {
        console.log(`📹 Attempting to download Facebook video: ${args}`);
        
        let videoUrl = null;
        let videoTitle = 'Facebook Video';
        let videoQuality = 'HD';
        let errorMessages = [];
        
        // Extract video ID from various Facebook URL formats
        let videoId = null;
        const patterns = [
            /\/videos\/(\d+)/,
            /\/watch\?v=(\d+)/,
            /\/share\/v\/([^\/]+)/,
            /\/reel\/(\d+)/,
            /\/watch\/\?v=(\d+)/
        ];
        
        for (const pattern of patterns) {
            const match = args.match(pattern);
            if (match) {
                videoId = match[1];
                break;
            }
        }
        
        // If we got a video ID, try to construct a direct link
        if (videoId) {
            console.log(`✅ Extracted video ID: ${videoId}`);
            const watchUrl = `https://www.facebook.com/watch?v=${videoId}`;
            
            // METHOD 1: Try fb-downloader with watch URL
            try {
                console.log('Method 1: Trying fb-downloader with watch URL...');
                const result = await fbDownloader(watchUrl);
                
                if (result && result.downloadUrl) {
                    videoUrl = result.downloadUrl;
                    videoTitle = result.title || 'Facebook Video';
                    videoQuality = result.quality || 'HD';
                    console.log('✅ fb-downloader succeeded');
                } else if (result && result.urls && result.urls.length > 0) {
                    const video = result.urls[0];
                    videoUrl = video.url || video.downloadUrl;
                    videoTitle = result.title || 'Facebook Video';
                    videoQuality = video.quality || 'HD';
                    console.log('✅ fb-downloader succeeded (alternative format)');
                }
            } catch (err) {
                errorMessages.push(`fb-downloader: ${err.message}`);
                console.log('❌ fb-downloader failed:', err.message);
            }
        }
        
        // METHOD 2: Try fb-downloader with original URL
        if (!videoUrl) {
            try {
                console.log('Method 2: Trying fb-downloader with original URL...');
                const result = await fbDownloader(args);
                
                if (result && result.downloadUrl) {
                    videoUrl = result.downloadUrl;
                    videoTitle = result.title || 'Facebook Video';
                    videoQuality = result.quality || 'HD';
                    console.log('✅ fb-downloader succeeded with original URL');
                } else if (result && result.urls && result.urls.length > 0) {
                    const video = result.urls[0];
                    videoUrl = video.url || video.downloadUrl;
                    videoTitle = result.title || 'Facebook Video';
                    videoQuality = video.quality || 'HD';
                    console.log('✅ fb-downloader succeeded (alternative format)');
                }
            } catch (err) {
                errorMessages.push(`fb-downloader (original): ${err.message}`);
                console.log('❌ fb-downloader with original URL failed:', err.message);
            }
        }
        
        // METHOD 3: Try alternative method - direct page scraping
        if (!videoUrl) {
            try {
                console.log('Method 3: Trying direct page scraping...');
                const response = await axios.get(args, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    },
                    timeout: 15000
                });
                
                const html = response.data;
                const videoPatterns = [
                    /"playable_url":\s*"([^"]+)"/,
                    /"src":"([^"]+\.mp4[^"]*)"/,
                    /"video_url":"([^"]+)"/,
                    /https:\/\/[^"'\s]+\.mp4[^"'\s]*/
                ];
                
                for (const pattern of videoPatterns) {
                    const match = html.match(pattern);
                    if (match) {
                        let foundUrl = match[1];
                        foundUrl = foundUrl.replace(/\\/g, '');
                        if (foundUrl.startsWith('http')) {
                            videoUrl = foundUrl;
                            console.log('✅ Found video URL in page source');
                            break;
                        }
                    }
                }
            } catch (err) {
                errorMessages.push(`Direct scraping: ${err.message}`);
                console.log('❌ Direct scraping failed:', err.message);
            }
        }
        
        // If we found a video URL, download it
        if (videoUrl) {
            try {
                const videoId2 = uuidv4();
                const videoFilename = `video_${videoId2}.mp4`;
                const videoPath = path.join(DOWNLOADS_PATH, videoFilename);
                
                ws.send(JSON.stringify({
                    type: 'shot_progress',
                    data: '⏳ Downloading video file... This may take a moment...'
                }));
                
                const response = await axios({
                    method: 'GET',
                    url: videoUrl,
                    responseType: 'stream',
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                const writer = fs.createWriteStream(videoPath);
                response.data.pipe(writer);
                
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                
                const stats = fs.statSync(videoPath);
                const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                
                const fileMessage = {
                    userId: userId,
                    username: 'Bot',
                    message: `📹 Facebook Video Downloaded`,
                    timestamp: new Date().toISOString(),
                    type: 'file',
                    file: {
                        name: videoTitle || 'Facebook Video.mp4',
                        filename: videoFilename,
                        size: stats.size,
                        sizeMB: fileSizeMB,
                        path: videoPath,
                        url: `/downloads/${videoFilename}`,
                        videoId: videoId2,
                        quality: videoQuality || 'HD'
                    }
                };
                
                const messages = getMessages();
                messages.push(fileMessage);
                saveMessages(messages);
                
                ws.send(JSON.stringify({
                    type: 'shot_success',
                    data: {
                        message: '✅ Video downloaded successfully!',
                        videoUrl: `/downloads/${videoFilename}`,
                        filename: videoTitle || 'Facebook Video.mp4',
                        size: fileSizeMB + ' MB',
                        quality: videoQuality || 'HD',
                        fileId: videoId2,
                        note: '📥 Video has been downloaded and is now available in your chat. Click to play or download.'
                    }
                }));
                
                broadcastMessage(null, {
                    type: 'file',
                    userId: userId,
                    username: 'Bot',
                    message: `📹 New video downloaded: ${videoTitle || 'Facebook Video'}`,
                    file: {
                        name: videoTitle || 'Facebook Video.mp4',
                        url: `/downloads/${videoFilename}`,
                        size: fileSizeMB + ' MB',
                        quality: videoQuality || 'HD'
                    },
                    timestamp: new Date().toISOString()
                });
                
                return;
                
            } catch (downloadError) {
                console.error('Video download error:', downloadError);
                ws.send(JSON.stringify({
                    type: 'error',
                    data: `❌ Error downloading video: ${downloadError.message}\n\n💡 The video URL was found but couldn't be downloaded. This might be due to network issues or the video being protected.`
                }));
                return;
            }
        }
        
        // If all methods failed
        const errorSummary = errorMessages.join('\n');
        ws.send(JSON.stringify({
            type: 'error',
            data: `❌ Could not download video.\n\nPossible reasons:\n1. The video might be private or restricted\n2. The link might be invalid\n3. Facebook may have blocked the download\n4. The video might be age-restricted\n\n💡 Try these alternatives:\n• Make sure the video is public\n• Try a different Facebook video link\n• Visit the link directly in your browser first\n\n🔧 Debug info:\n${errorSummary}`
        }));
        
    } catch (error) {
        console.error('Facebook download error:', error);
        ws.send(JSON.stringify({
            type: 'error',
            data: `❌ Download failed: ${error.message}\n\n💡 Tips:\n1. Make sure the video is public\n2. Try a different Facebook video link\n3. The video might be protected or removed`
        }));
    }
}

// ============================================
// 👑 ADMIN UPGRADE COMMAND
// ============================================
async function handleUpgrade(args, ws, userId) {
    const users = getUsers();
    const currentUser = users[userId];
    
    if (!currentUser || currentUser.role !== 'admin') {
        ws.send(JSON.stringify({
            type: 'error',
            data: '❌ You do not have permission to use this command. Admin only.'
        }));
        return;
    }
    
    if (!args) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Usage: .upgrade [userID] [numberOfDays]'
        }));
        return;
    }
    
    const parts = args.split(' ');
    const targetUserId = parts[0];
    const days = parseInt(parts[1]);
    
    if (!targetUserId || !days || days <= 0) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Invalid parameters. Usage: .upgrade [userID] [numberOfDays]'
        }));
        return;
    }
    
    if (!users[targetUserId]) {
        ws.send(JSON.stringify({
            type: 'error',
            data: `❌ User ${targetUserId} not found`
        }));
        return;
    }
    
    const trials = getTrials();
    if (!trials[targetUserId]) {
        trials[targetUserId] = { used: 0, total: 5, expiry: null };
    }
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    trials[targetUserId].expiry = expiryDate.toISOString();
    trials[targetUserId].total = 999;
    
    saveTrials(trials);
    
    ws.send(JSON.stringify({
        type: 'upgrade_success',
        data: {
            userId: targetUserId,
            username: users[targetUserId].username,
            days: days,
            expiry: expiryDate.toISOString()
        }
    }));
    
    const client = clients.get(targetUserId);
    if (client) {
        client.ws.send(JSON.stringify({
            type: 'upgraded',
            data: {
                message: `🎉 Your account has been upgraded to premium for ${days} days!`,
                expiry: expiryDate.toISOString()
            }
        }));
    }
}

// ============================================
// 📊 TRIALS COMMAND
// ============================================
function handleTrials(ws, userId) {
    const trials = getUserTrials(userId);
    const users = getUsers();
    const user = users[userId];
    
    const isPremium = trials.expiry ? new Date(trials.expiry) > new Date() : false;
    let message = `📊 Trial Information\n\n`;
    message += `User ID: ${userId}\n`;
    message += `Username: ${user ? user.username : 'Unknown'}\n`;
    message += `Trials Used: ${trials.used}/${trials.total}\n`;
    message += `Status: ${isPremium ? '✅ PREMIUM' : '🆓 Free User'}\n`;
    
    if (isPremium) {
        const expiryDate = new Date(trials.expiry);
        const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
        message += `Premium Expiry: ${new Date(trials.expiry).toLocaleDateString()} (${daysLeft} days left)\n`;
    } else {
        const remaining = trials.total - trials.used;
        message += `Remaining Free Trials: ${remaining}\n`;
        if (remaining === 0) {
            message += `\n⚠️ You have used all free trials!\n`;
            message += `Upgrade to premium: K500 via TNM Mpamba (0891011842) or Airtel Money (0985280353)\n`;
            message += `After payment, send confirmation + your ID to admin on WhatsApp: 0899128441`;
        }
    }
    
    ws.send(JSON.stringify({
        type: 'trials_info',
        data: message
    }));
}

// ============================================
// 📡 BROADCAST FUNCTION
// ============================================
function broadcastMessage(targetUserId, message) {
    const payload = JSON.stringify({
        type: 'public',
        data: message
    });
    
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

// ============================================
// 📁 STATIC FILES & ENDPOINTS
// ============================================
app.use('/downloads', express.static(DOWNLOADS_PATH));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        apiKeys: {
            weather: process.env.WEATHER_API_KEY ? '✅ Set' : '❌ Missing',
            news: process.env.NEWS_API_KEY ? '✅ Set' : '❌ Missing'
        }
    });
});

app.get('/debug-env', (req, res) => {
    const envVars = {
        WEATHER_API_KEY: process.env.WEATHER_API_KEY ? '✅ Set' : '❌ Missing',
        NEWS_API_KEY: process.env.NEWS_API_KEY ? '✅ Set' : '❌ Missing',
        JWT_SECRET: process.env.JWT_SECRET ? '✅ Set' : '❌ Missing',
        DB_PATH: process.env.DB_PATH || 'Not set',
        NODE_ENV: process.env.NODE_ENV || 'Not set',
        PORT: process.env.PORT || 'Not set'
    };
    
    try {
        const envPath = path.join(__dirname, '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const keys = envContent.split('\n')
                .filter(line => line.trim() && !line.startsWith('#'))
                .map(line => line.split('=')[0]);
            envVars['.env_file_found'] = '✅ Yes';
            envVars['.env_keys'] = keys;
        } else {
            envVars['.env_file_found'] = '❌ No';
        }
    } catch (err) {
        envVars['.env_file_found'] = '⚠️ Error reading: ' + err.message;
    }
    
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        environment: envVars
    });
});

// ============================================
// 🚀 START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Bot server running on http://localhost:${PORT}`);
    console.log(`✅ WebSocket server running on ws://localhost:${PORT}`);
    console.log(`✅ Health check: http://localhost:${PORT}/health`);
    console.log(`✅ Debug env: http://localhost:${PORT}/debug-env`);
    console.log(`✅ Facebook video downloader is ready!`);
    console.log(`✅ Videos will be saved to: ${DOWNLOADS_PATH}\n`);
});
