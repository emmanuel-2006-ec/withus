const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const https = require('https');

// ----------------------------------------------
// 📌 CONFIGURATION
// ----------------------------------------------
const ADMIN_NAME = 'Emmanuel@1';
const ADMIN_ID = null;

// 🔑 GOOGLE GEMINI API KEY (Inserted)
const GEMINI_API_KEY = 'AQ.Ab8RN6Ltd3nd8iDtj-iVdLrENtMsm6wUwqmBneZ_WRKkkxiXbA';

// 🍪 SPOTIFY COOKIE (Leave empty if not using)
const SPOTIFY_COOKIE = '';

// ----------------------------------------------
// 📂 SETUP
// ----------------------------------------------
const TEMP_DIR = './temp_downloads/';
const DB_PATH = './database.json';

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

function loadDB() {
    if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH));
    }
    return { users: {}, announcements: [], groupMessages: [], downloads: [] };
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ----------------------------------------------
// 🛠️ REAL AI ASSIGNMENT WRITER (Google Gemini)
// ----------------------------------------------
async function generateAIAssignment(topic, field, pages = 3, citations = 'yes') {
    const prompt = `Write a detailed academic assignment on the topic: "${topic}" in the field of "${field}".

Requirements:
- Length: ${pages} pages (approximately ${parseInt(pages) * 350} words)
- Format: Academic essay with proper structure
- Citations: ${citations === 'yes' ? 'Include APA in-text citations and a reference list at the end' : 'No citations needed'}
- Content should be original, well-researched, and comprehensive
- Include introduction, body paragraphs with topic sentences, and conclusion
- Answer the question thoroughly with real examples and explanations

Format the response with:
1. Introduction
2. Main body (with clear sections and subheadings)
3. Conclusion
4. References (if citations are requested)

The assignment should be written in a clear, academic style that demonstrates deep understanding of the subject.`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: prompt }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 2048,
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error('Gemini API Error:', data.error);
            return `❌ API Error: ${data.error.message}\n\nPlease check your Gemini API key and try again.`;
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No content generated.';
        
        // Format the response for the chat
        let formatted = `📚 *ASSIGNMENT: ${topic.toUpperCase()}*\n\n`;
        formatted += `📖 *Field:* ${field || 'General Studies'}\n`;
        formatted += `📄 *Pages:* ${pages}\n`;
        formatted += `📝 *Citations:* ${citations === 'yes' ? 'Included (APA Format)' : 'Not Included'}\n`;
        formatted += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        formatted += text;
        formatted += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        formatted += `✅ Assignment generated using with us AI w AI\n`;
        formatted += `📌 *Note:* This is AI-generated content. Please review and edit as needed.`;

        return formatted;
    } catch (error) {
        console.error('AI Assignment Error:', error);
        return `❌ Failed to generate assignment: ${error.message}\n\nPlease try again later.`;
    }
}

// ----------------------------------------------
// 🛠️ SEARCH FUNCTION (TikTok + Dailymotion)
// ----------------------------------------------
function searchAndDownload(query, outputPath, type = 'video') {
    return new Promise((resolve, reject) => {
        const sources = [
            { name: 'TikTok', prefix: `tiksearch:${query}` },
            { name: 'Dailymotion', prefix: `dmsearch:${query}` }
        ];

        let currentIndex = 0;

        function tryNextSource() {
            if (currentIndex >= sources.length) {
                return reject(new Error(`No results found for "${query}" on TikTok or Dailymotion.`));
            }

            const source = sources[currentIndex];
            currentIndex++;
            console.log(`🔍 Searching ${source.name} for: ${query}`);

            const typeArg = type === 'audio' ? 'bestaudio --extract-audio --audio-format mp3' : 'bestvideo+bestaudio --merge-output-format mp4';
            const command = `yt-dlp -f ${typeArg} --no-check-certificate -o "${outputPath}" "${source.prefix}"`;

            console.log(`🔍 Running: ${command}`);

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.log(`❌ ${source.name} failed. Trying next...`);
                    tryNextSource();
                } else {
                    console.log(`✅ Download complete from ${source.name}: ${outputPath}`);
                    resolve(outputPath);
                }
            });
        }

        tryNextSource();
    });
}

function downloadDirect(url, outputPath, type = 'video') {
    return new Promise((resolve, reject) => {
        const typeArg = type === 'audio' ? 'bestaudio --extract-audio --audio-format mp3' : 'bestvideo+bestaudio --merge-output-format mp4';
        const command = `yt-dlp -f ${typeArg} --no-check-certificate -o "${outputPath}" "${url}"`;

        console.log(`🔍 Running: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ yt-dlp error: ${stderr}`);
                reject(new Error(`Download failed: ${stderr || error.message}`));
            } else {
                console.log(`✅ Download complete: ${outputPath}`);
                resolve(outputPath);
            }
        });
    });
}

// ----------------------------------------------
// 🚀 EXPRESS SERVER
// ----------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.send('OK'));

// ----------------------------------------------
// 📨 CHAT API
// ----------------------------------------------
app.post('/api/chat', async (req, res) => {
    const { userId, username, message } = req.body;
    
    if (!message) {
        return res.json({ reply: '⚠️ Please enter a command or message.' });
    }

    const db = loadDB();
    const userKey = userId || username || 'anonymous';
    const isAdmin = (username === ADMIN_NAME) || (ADMIN_ID && userKey === ADMIN_ID);

    if (!db.users[userKey]) {
        db.users[userKey] = { 
            count: 0, 
            username: username || 'User',
            joined: new Date().toISOString()
        };
        saveDB(db);
    }

    const user = db.users[userKey];
    const isPremium = user.premium && user.expiry > Date.now();

    // ----------------------------------------------
    // 🧠 SMART WELCOME
    // ----------------------------------------------
    const greetings = ['hello', 'hy', 'hey', 'hi', 'hola', 'sup', 'yo'];
    const lowerMsg = message.toLowerCase().trim();
    
    if (greetings.includes(lowerMsg)) {
        const remaining = isPremium ? '♾️ Unlimited' : Math.max(0, 4 - user.count);
        const reply = `👋 *Welcome, ${user.username || 'User'}!*\n\n` +
            `🤖 *with-us AI* is here to help you.\n\n` +
            `📊 *You have ${remaining} free downloads left.*\n\n` +
            `📌 *Type .assist to see all available commands*`;
        return res.json({ reply });
    }

    // ----------------------------------------------
    // 👑 ADMIN COMMANDS
    // ----------------------------------------------
    if (message === '.users' && isAdmin) {
        const users = db.users;
        const userList = Object.keys(users).map(key => {
            const u = users[key];
            const premium = u.premium && u.expiry > Date.now() ? '✅ Premium' : '❌ Free';
            const remaining = premium === '✅ Premium' ? '♾️' : Math.max(0, 4 - u.count);
            return `• *${u.username || 'User'}* (${key})\n  ${premium} | ${remaining} downloads left`;
        }).join('\n\n');
        return res.json({ reply: `📊 *Registered Users (${Object.keys(users).length})*\n\n${userList || 'No users yet.'}` });
    }

    if (message === '.id') {
        const remaining = isPremium ? '♾️ Unlimited' : Math.max(0, 4 - user.count);
        return res.json({ reply: `👤 *Your Profile*\n📌 *Username:* ${user.username}\n🆔 *User ID:* ${userKey}\n📊 *Downloads left:* ${remaining}\n👑 *Admin:* ${isAdmin ? '✅ Yes' : '❌ No'}` });
    }

    if (message.startsWith('.broadcast ') && isAdmin) {
        const broadcastMsg = message.slice(11).trim();
        if (!broadcastMsg) return res.json({ reply: '❌ Please provide a message.' });
        if (!db.announcements) db.announcements = [];
        db.announcements.push({ from: '📢 Admin', message: broadcastMsg, time: new Date().toISOString(), id: Date.now() });
        saveDB(db);
        return res.json({ 
            reply: `📢 *Announcement Sent!*\n\n"${broadcastMsg}"`,
            announcement: { from: '📢 Admin', message: broadcastMsg, time: new Date().toISOString() }
        });
    }

    if (message.startsWith('.upgrade ') && isAdmin) {
        const parts = message.split(' ');
        if (parts.length === 3) {
            const targetUser = parts[1];
            const days = parseInt(parts[2]);
            if (!isNaN(days) && days > 0) {
                if (!db.users[targetUser]) return res.json({ reply: `❌ User "${targetUser}" not found.` });
                db.users[targetUser].premium = true;
                db.users[targetUser].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                saveDB(db);
                const targetName = db.users[targetUser].username || targetUser;
                if (!db.announcements) db.announcements = [];
                const announcement = { from: '🎉 System', message: `🎉 *${targetName}* (${targetUser}) was upgraded to Premium for ${days} days!`, time: new Date().toISOString(), id: Date.now() };
                db.announcements.push(announcement);
                saveDB(db);
                return res.json({ 
                    reply: `✅ ${targetName} (${targetUser}) upgraded for ${days} days!`,
                    announcement: announcement
                });
            }
        }
        return res.json({ reply: '❌ Usage: .upgrade <userId> <days>' });
    }

    // ----------------------------------------------
    // 💬 .me <message>
    // ----------------------------------------------
    if (message.startsWith('.me ')) {
        const groupMsg = message.slice(4).trim();
        if (!groupMsg) return res.json({ reply: '❌ Please provide a message to share.' });
        if (!db.groupMessages) db.groupMessages = [];
        const newMsg = {
            id: Date.now(),
            username: user.username || 'User',
            userId: userKey,
            message: groupMsg,
            time: new Date().toISOString()
        };
        db.groupMessages.push(newMsg);
        saveDB(db);
        return res.json({
            reply: `💬 *${user.username || 'User'}*: ${groupMsg}`,
            groupMessage: newMsg
        });
    }

    // ----------------------------------------------
    // 📝 .task (AI-POWERED - Uses Google Gemini)
    // ----------------------------------------------
    if (message.startsWith('.task ')) {
        const parts = message.slice(6).split(' ');
        const topic = parts[0] || 'General Topic';
        const field = parts.slice(1, -2).join(' ') || 'General Studies';
        const pages = parts[parts.length - 2] || '3';
        const citations = parts[parts.length - 1] || 'yes';

        try {
            const assignment = await generateAIAssignment(topic, field, pages, citations);
            return res.json({ reply: assignment });
        } catch (error) {
            console.error('Task error:', error);
            return res.json({ 
                reply: `❌ Failed to generate assignment: ${error.message}\n\n` +
                       `📝 *Usage:* .task <topic> <field> <pages> <citations>\n` +
                       `💡 *Example:* .task AI in Healthcare Computer Science 5 yes`
            });
        }
    }

    // ----------------------------------------------
    // 📖 .assist (COMPLETE COMMAND LIST)
    // ----------------------------------------------
    if (message === '.assist') {
        const helpText = `📖 *with-us AI - Complete Command List*\n\n` +
            `┌─────────────────────────────────────────────┐\n` +
            `│ 🎵 MEDIA DOWNLOAD                         │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ .search <title>                           │\n` +
            `│   └─ Search TikTok & Dailymotion          │\n` +
            `│   └─ Downloads directly to your device    │\n` +
            `│   └─ Example: .search Despacito           │\n` +
            `│                                           │\n` +
            `│ .dl <URL>                                │\n` +
            `│   └─ Download from ANY platform          │\n` +
            `│   └─ Example: .dl https://youtu.be/...   │\n` +
            `│                                           │\n` +
            `│ .play <song>                             │\n` +
            `│   └─ Download audio (MP3)                │\n` +
            `│   └─ Example: .play Despacito            │\n` +
            `│                                           │\n` +
            `│ .vid <video>                             │\n` +
            `│   └─ Download video (MP4)                │\n` +
            `│   └─ Example: .vid funny cats            │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ 📝 AI ASSIGNMENT WRITER                   │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ .task <topic> <field> <pages> <citations>│\n` +
            `│   └─ Write assignment using AI (Gemini)  │\n` +
            `│   └─ Example: .task AI in Healthcare     │\n` +
            `│      Computer Science 5 yes              │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ 💬 GROUP CHAT                            │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ .me <message>                            │\n` +
            `│   └─ Send message to all users           │\n` +
            `│   └─ Example: .me Hello everyone!        │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ 👤 USEFUL COMMANDS                        │\n` +
            `├─────────────────────────────────────────────┤\n` +
            `│ .developer  - About the developer         │\n` +
            `│ .id         - Your profile & ID           │\n` +
            `│ .users      - All users (Admin only)      │\n` +
            `│ .upgrade    - Upgrade user (Admin only)   │\n` +
            `│ .broadcast  - Announcement (Admin only)   │\n` +
            `└─────────────────────────────────────────────┘\n\n` +
            `💡 *Type "hello" for a warm welcome!*\n` +
            `💡 *Try:* .search Despacito\n` +
            `💡 *Try:* .task Climate Change Environmental Science 4 yes\n` +
            `💡 *Try:* .me Hello everyone!`;
        return res.json({ reply: helpText });
    }

    // ----------------------------------------------
    // 👤 .developer
    // ----------------------------------------------
    if (message === '.developer') {
        return res.json({ 
            reply: `👨‍💻 *Developer Profile*\n\n` +
                `📌 *Name:* Emmanuel Chimombo\n` +
                `💼 *Role:* Full Stack System and Online Applications Developer\n` +
                `🎓 *Education:* ICT Student, Mzuzu University\n` +
                `🌍 *Location:* Malawi\n\n` +
                `🤖 *Bot:* with-us AI - Universal Media Downloader & AI Assignment Writer.`
        });
    }

    // ----------------------------------------------
    // 🎵 .search (TikTok + Dailymotion - Downloads Directly)
    // ----------------------------------------------
    if (message.startsWith('.search ')) {
        const query = message.slice(8);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\n🆔 *Your ID:* ${userKey}\n👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await searchAndDownload(query, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                fs.unlinkSync(filePath);
                return res.json({ reply: `❌ File too large (${fileSizeMB.toFixed(1)}MB). Limit is 64MB.` });
            }

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) { user.count += 1; saveDB(db); }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `${query}.mp4`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ *${query}* - Downloaded!\n\n🎬 *Click play below to watch!*`
            });
        } catch (error) {
            console.error('Search error:', error);
            return res.json({ 
                reply: `❌ ${error.message}\n\n` +
                       `💡 *Tips:*\n` +
                       `• Try a different search term\n` +
                       `• Use .dl with a direct link\n` +
                       `• Use .play for audio only`
            });
        }
    }

    // ----------------------------------------------
    // 🎵 .play
    // ----------------------------------------------
    if (message.startsWith('.play ')) {
        const query = message.slice(6);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\n🆔 *Your ID:* ${userKey}\n👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
            await searchAndDownload(query, filePath, 'audio');

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) { user.count += 1; saveDB(db); }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `${query}.mp3`,
                file: base64File,
                mimeType: 'audio/mpeg',
                reply: `✅ *${query}* - Downloaded!\n\n🎵 *Click play below to listen!*`
            });
        } catch (error) {
            console.error('Play error:', error);
            return res.json({ reply: `❌ ${error.message}\n\n💡 Try .search or .dl with a direct link.` });
        }
    }

    // ----------------------------------------------
    // 🎬 .vid
    // ----------------------------------------------
    if (message.startsWith('.vid ')) {
        const query = message.slice(5);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\n🆔 *Your ID:* ${userKey}\n👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await searchAndDownload(query, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                fs.unlinkSync(filePath);
                return res.json({ reply: `❌ Video too large (${fileSizeMB.toFixed(1)}MB). Limit is 64MB.` });
            }

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) { user.count += 1; saveDB(db); }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `${query}.mp4`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ *${query}* - Downloaded!\n\n🎬 *Click play below to watch!*`
            });
        } catch (error) {
            console.error('Video error:', error);
            return res.json({ reply: `❌ ${error.message}\n\n💡 Try .search or .dl with a direct link.` });
        }
    }

    // ----------------------------------------------
    // 📹 .dl <URL>
    // ----------------------------------------------
    if (message.startsWith('.dl ')) {
        const url = message.slice(4).trim();
        if (!url || !url.startsWith('http')) {
            return res.json({ reply: '❌ Please provide a valid URL.' });
        }

        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\n🆔 *Your ID:* ${userKey}\n👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await downloadDirect(url, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                fs.unlinkSync(filePath);
                return res.json({ reply: `❌ File too large (${fileSizeMB.toFixed(1)}MB). Limit is 64MB.` });
            }

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) { user.count += 1; saveDB(db); }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `video_${Date.now()}.mp4`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ Download complete!\n\n📥 *File saved to your device.*`
            });
        } catch (error) {
            console.error('DL error:', error);
            return res.json({ reply: `❌ Failed to download: ${error.message}` });
        }
    }

    // ----------------------------------------------
    // UNKNOWN COMMAND
    // ----------------------------------------------
    return res.json({ 
        reply: `❌ Unknown command. Type .assist to see all commands.\n\n` +
               `💡 *Try:* hello, .search, .task, .me, .dl`
    });
});

// ----------------------------------------------
// 📢 GET ANNOUNCEMENTS & GROUP MESSAGES
// ----------------------------------------------
app.get('/api/announcements', (req, res) => {
    const db = loadDB();
    const announcements = db.announcements || [];
    res.json({ announcements });
});

app.get('/api/groupmessages', (req, res) => {
    const db = loadDB();
    const groupMessages = db.groupMessages || [];
    res.json({ groupMessages });
});

// ----------------------------------------------
// ▶️ START
// ----------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ with-us AI Chat running on port ${PORT}`);
    console.log(`🌐 Open: https://withus.onrender.com`);
    console.log(`🤖 Gemini AI: ✅ Set`);
});
