// server.js - Enhanced with authentication and payment system
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database file paths
const DB_PATH = path.join(__dirname, 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');
const TRIALS_FILE = path.join(DB_PATH, 'trials.json');
const MESSAGES_FILE = path.join(DB_PATH, 'messages.json');

// Ensure data directory exists
if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize database files
function initDB() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({
            admin: {
                username: 'blessed',
                password: '$2a$10$YOUR_HASHED_PASSWORD', // Will be set on first run
                role: 'admin',
                created: new Date().toISOString()
            }
        }, null, 2));
    }
    
    if (!fs.existsSync(TRIALS_FILE)) {
        fs.writeFileSync(TRIALS_FILE, JSON.stringify({}, null, 2));
    }
    
    if (!fs.existsSync(MESSAGES_FILE)) {
        fs.writeFileSync(MESSAGES_FILE, JSON.stringify([], null, 2));
    }
}

// Hash password function
async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

// Initialize admin password on first run
async function setupAdmin() {
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    if (users.admin && users.admin.password === '$2a$10$YOUR_HASHED_PASSWORD') {
        users.admin.password = await hashPassword('emmanuel');
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
        console.log('Admin password initialized');
    }
}

initDB();
setupAdmin();

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
let messageHistory = [];

// User management functions
function getUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function getTrials() {
    return JSON.parse(fs.readFileSync(TRIALS_FILE, 'utf8'));
}

function saveTrials(trials) {
    fs.writeFileSync(TRIALS_FILE, JSON.stringify(trials, null, 2));
}

function getMessages() {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
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

// Authentication middleware
function authenticate(token) {
    try {
        const decoded = jwt.verify(token, 'your-secret-key');
        return decoded;
    } catch (error) {
        return null;
    }
}

function isAdmin(userId) {
    const users = getUsers();
    return users[userId] && users[userId].role === 'admin';
}

function getUserTrials(userId) {
    const trials = getTrials();
    return trials[userId] || { used: 0, total: 5, expiry: null };
}

function hasTrialAvailable(userId) {
    const userTrials = getUserTrials(userId);
    if (userTrials.expiry) {
        // Check if premium user
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
        // Premium user - no limit
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
                // Handle authentication
                const { username, password } = data;
                const users = getUsers();
                
                let foundUser = null;
                let foundUserId = null;
                
                // Check if admin
                if (username === 'blessed' && users.admin) {
                    const isValid = await bcrypt.compare(password, users.admin.password);
                    if (isValid) {
                        foundUser = users.admin;
                        foundUserId = 'admin';
                        foundUser.role = 'admin';
                    }
                }
                
                // Check regular users
                if (!foundUser) {
                    for (const [id, user] of Object.entries(users)) {
                        if (user.username === username && id !== 'admin') {
                            const isValid = await bcrypt.compare(password, user.password);
                            if (isValid) {
                                foundUser = user;
                                foundUserId = id;
                                break;
                            }
                        }
                    }
                }
                
                if (foundUser && foundUserId) {
                    userId = foundUserId;
                    authenticated = true;
                    
                    // Generate JWT token
                    const token = jwt.sign(
                        { userId, username: foundUser.username, role: foundUser.role || 'user' },
                        'your-secret-key',
                        { expiresIn: '24h' }
                    );
                    
                    // Store client connection
                    clients.set(userId, { ws, user: foundUser, token });
                    
                    ws.send(JSON.stringify({
                        type: 'auth_success',
                        data: {
                            userId: userId,
                            username: foundUser.username,
                            role: foundUser.role || 'user',
                            token: token,
                            trials: getUserTrials(userId)
                        }
                    }));
                    
                    // Send login notification to admin
                    if (userId !== 'admin') {
                        const adminWs = clients.get('admin');
                        if (adminWs) {
                            adminWs.ws.send(JSON.stringify({
                                type: 'user_login',
                                data: {
                                    userId: userId,
                                    username: foundUser.username,
                                    time: new Date().toISOString()
                                }
                            }));
                        }
                    }
                    
                    // Send message history
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
                        data: 'Invalid username or password'
                    }));
                }
                return;
            }
            
            // Only allow authenticated users to use commands
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
            
            // Process commands
            await handleCommand(data.command, data.args, ws, userId);
            
            // Use trial for non-admin users (except for certain commands)
            if (userId !== 'admin' && !['.myid', '.assist', '.developer', '.upgrade'].includes(data.command)) {
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
            await handleWeather(args, ws, userId);
            break;
        case '.news':
            await handleNews(args, ws, userId);
            break;
        case '.read':
            await handleRead(args, ws, userId);
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
            await handleTune(args, ws, userId);
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

async function handleWeather(args, ws, userId) {
    const city = args || 'Lilongwe';
    
    try {
        const apiKey = process.env.WEATHER_API_KEY || 'YOUR_API_KEY';
        const response = await axios.get(
            `https://api.openweathermap.org/data/2.5/forecast?q=${city}&units=metric&appid=${apiKey}&cnt=5`
        );
        
        const forecast = response.data.list.map(day => ({
            date: new Date(day.dt * 1000).toLocaleDateString(),
            temp: day.main.temp,
            description: day.weather[0].description,
            humidity: day.main.humidity
        }));
        
        ws.send(JSON.stringify({
            type: 'weather',
            data: {
                city: response.data.city.name,
                forecast: forecast
            }
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Unable to fetch weather data. Please try again.'
        }));
    }
}

async function handleNews(args, ws, userId) {
    const category = args || 'global';
    
    try {
        const apiKey = process.env.NEWS_API_KEY || 'YOUR_NEWS_API_KEY';
        let url = `https://gnews.io/api/v4/top-headlines?token=${apiKey}&lang=en`;
        
        if (category === 'malawi') {
            url = `https://gnews.io/api/v4/search?q=malawi&token=${apiKey}&lang=en`;
        }
        
        const response = await axios.get(url);
        const articles = response.data.articles.slice(0, 5).map(article => ({
            title: article.title,
            description: article.description,
            source: article.source.name,
            url: article.url
        }));
        
        ws.send(JSON.stringify({
            type: 'news',
            data: {
                category: category,
                articles: articles
            }
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Unable to fetch news. Please try again.'
        }));
    }
}

let fileReading = {};
let readTimeout = {};

function handleRead(args, ws, userId) {
    ws.send(JSON.stringify({
        type: 'read_prompt',
        data: 'Please upload a text file to read'
    }));
}

// File upload endpoint for .read command
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');
    
    // Store file content in memory for reading
    global.readFile = {
        lines: lines,
        currentIndex: 0,
        filePath: filePath
    };
    
    res.json({
        message: 'File uploaded successfully. Starting to read...',
        totalLines: lines.length
    });
});

app.post('/read/control', (req, res) => {
    const { action, userId } = req.body;
    
    if (action === 'start') {
        if (!global.readFile) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        fileReading[userId] = true;
        readNextLine(userId);
        res.json({ message: 'Started reading file' });
    } else if (action === 'stop') {
        fileReading[userId] = false;
        if (readTimeout[userId]) {
            clearTimeout(readTimeout[userId]);
            readTimeout[userId] = null;
        }
        res.json({ message: 'Stopped reading' });
    }
});

function readNextLine(userId) {
    if (!fileReading[userId] || !global.readFile) return;
    
    const file = global.readFile;
    if (file.currentIndex < file.lines.length) {
        const line = file.lines[file.currentIndex];
        file.currentIndex++;
        
        broadcastMessage(userId, `📖 Line ${file.currentIndex}/${file.lines.length}: ${line}`);
        
        readTimeout[userId] = setTimeout(() => readNextLine(userId), 2000);
    } else {
        fileReading[userId] = false;
        broadcastMessage(userId, '✅ Finished reading the entire document');
    }
}

function handleMe(args, ws, userId) {
    const message = args || 'Hello everyone!';
    const users = getUsers();
    const user = users[userId];
    
    const publicMessage = {
        userId: userId,
        username: user ? user.username : 'Unknown',
        message: message,
        timestamp: new Date().toISOString()
    };
    
    // Save to message history
    const messages = getMessages();
    messages.push(publicMessage);
    saveMessages(messages);
    
    // Broadcast to all clients
    broadcastMessage(null, `💬 ${user ? user.username : 'Unknown'}: ${message}`);
    
    ws.send(JSON.stringify({
        type: 'confirm',
        data: 'Message sent to everyone'
    }));
}

function handleAssist(ws, userId) {
    const commands = [
        { command: '.myid', description: 'Show your unique user ID and trial status' },
        { command: '.weather [city]', description: 'Predict next 5 days weather (default: Lilongwe)' },
        { command: '.news [global/malawi]', description: 'Show trending global or Malawi news' },
        { command: '.read', description: 'Open phone storage to choose document and read line by line' },
        { command: '.me [message]', description: 'Send public message to everyone logged in' },
        { command: '.assist', description: 'Display all commands and how to use' },
        { command: '.developer', description: 'Show developer information' },
        { command: '.tune [passage]', description: 'Rewrite AI-generated text in human form' },
        { command: '.shot [fb link]', description: 'Download video from Facebook via link' },
        { command: '.trials', description: 'Check your remaining free trials' }
    ];
    
    // Add admin-only commands
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

async function handleTune(args, ws, userId) {
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
    
    // Remove common AI markers
    humanized = humanized.replace(/in conclusion/gi, '');
    humanized = humanized.replace(/furthermore/gi, '');
    humanized = humanized.replace(/additionally/gi, '');
    humanized = humanized.replace(/it is important to note that/gi, '');
    
    // Add personal touches
    humanized = humanized.replace(/AI/gi, 'technology');
    humanized = humanized.replace(/machine learning/gi, 'smart algorithms');
    
    // Add conversational elements
    const introPhrases = [
        'I think ', 'In my experience, ', 'Honestly, ',
        'From what I\'ve seen, ', 'It seems like '
    ];
    
    if (Math.random() > 0.7) {
        humanized = introPhrases[Math.floor(Math.random() * introPhrases.length)] + humanized.toLowerCase();
    }
    
    // Add contractions
    humanized = humanized.replace(/do not/g, 'don\'t');
    humanized = humanized.replace(/cannot/g, 'can\'t');
    humanized = humanized.replace(/will not/g, 'won\'t');
    humanized = humanized.replace(/is not/g, 'isn\'t');
    humanized = humanized.replace(/are not/g, 'aren\'t');
    
    return humanized;
}

async function handleShot(args, ws, userId) {
    if (!args || !args.startsWith('http')) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Please provide a valid Facebook video link. Example: .shot https://facebook.com/...'
        }));
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'shot_progress',
        data: 'Processing Facebook video download...'
    }));
    
    try {
        const videoId = args.match(/\/(?:videos|watch)\/(\d+)/)?.[1] || 'unknown';
        
        ws.send(JSON.stringify({
            type: 'shot_success',
            data: {
                message: 'Facebook video download started',
                videoId: videoId,
                status: 'processing',
                note: 'This feature requires a third-party service in production'
            }
        }));
    } catch (error) {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'Error processing Facebook video download'
        }));
    }
}

// Admin command: Upgrade user
async function handleUpgrade(args, ws, userId) {
    const users = getUsers();
    const currentUser = users[userId];
    
    // Check if user is admin
    if (!currentUser || currentUser.role !== 'admin') {
        ws.send(JSON.stringify({
            type: 'error',
            data: 'You do not have permission to use this command. Admin only.'
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
    
    // Check if user exists
    if (!users[targetUserId]) {
        ws.send(JSON.stringify({
            type: 'error',
            data: `User ${targetUserId} not found`
        }));
        return;
    }
    
    // Update trials
    const trials = getTrials();
    if (!trials[targetUserId]) {
        trials[targetUserId] = { used: 0, total: 5, expiry: null };
    }
    
    // Set expiry date
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);
    trials[targetUserId].expiry = expiryDate.toISOString();
    trials[targetUserId].total = 999; // Unlimited for premium
    
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
    
    // Notify the upgraded user
    const client = clients.get(targetUserId);
    if (client) {
        client.ws.send(JSON.stringify({
            type: 'upgraded',
            data: {
                message: `Your account has been upgraded to premium for ${days} days!`,
                expiry: expiryDate.toISOString()
            }
        }));
    }
}

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
        message += `Premium Expiry: ${trials.expiry} (${daysLeft} days left)\n`;
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

// Broadcast message to specific user or all users
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

// Serve the HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Bot server running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
