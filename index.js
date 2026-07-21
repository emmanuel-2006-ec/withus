const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// ----------------------------------------------
// 📌 CONFIGURATION
// ----------------------------------------------
const ADMIN_NAME = 'Emmanuel';
const ADMIN_ID = null;

// 🔑 HUGGING FACE API KEY
const HF_API_KEY = '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';

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
// 🛠️ AI ASSIGNMENT WRITER (Hugging Face - FIXED)
// ----------------------------------------------
async function generateAIAssignment(topic, field, pages = 3, citations = 'yes') {
    const prompt = `Write a detailed academic assignment on the topic: "${topic}" in the field of "${field}".

Requirements:
- Length: ${pages} pages (approximately ${parseInt(pages) * 350} words)
- Format: Academic essay with proper structure
- Citations: ${citations === 'yes' ? 'Include APA in-text citations and a reference list at the end' : 'No citations needed'}
- Include introduction, body paragraphs, and conclusion

Format:
1. Introduction
2. Main body
3. Conclusion
4. References (if citations requested)`;

    try {
        const response = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${HF_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: prompt,
                parameters: {
                    max_new_tokens: 1500,
                    temperature: 0.7,
                    do_sample: true
                }
            })
        });

        const data = await response.json();
        
        // Check if the model is still loading
        if (data.error && data.error.includes('loading')) {
            return `⏳ *The AI model is waking up...*\n\nPlease try again in 2-3 minutes. 🚀`;
        }

        if (data.error) {
            console.error('Hugging Face Error:', data.error);
            return `❌ API Error: ${data.error.message || data.error}. Please try again later.`;
        }

        // Handle different response formats
        let text = '';
        if (Array.isArray(data) && data.length > 0 && data[0].generated_text) {
            text = data[0].generated_text.replace(prompt, '').trim();
        } else if (data.generated_text) {
            text = data.generated_text.replace(prompt, '').trim();
        } else if (typeof data === 'string') {
            text = data;
        } else {
            text = JSON.stringify(data);
        }

        if (!text || text.length < 50) {
            return `⚠️ The AI model is currently busy. Please try again in a few minutes.`;
        }

        let formatted = `📚 *ASSIGNMENT: ${topic.toUpperCase()}*\n\n`;
        formatted += `📖 *Field:* ${field || 'General Studies'}\n`;
        formatted += `📄 *Pages:* ${pages}\n`;
        formatted += `📝 *Citations:* ${citations === 'yes' ? 'Included (APA Format)' : 'Not Included'}\n`;
        formatted += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        formatted += text;
        formatted += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        formatted += `✅ Generated using Hugging Face AI (Mistral-7B)`;

        return formatted;
    } catch (error) {
        console.error('AI Error:', error);
        return `❌ Failed to generate assignment. Please try again in a few minutes. Error: ${error.message}`;
    }
}

// ----------------------------------------------
// 🛠️ SEARCH FUNCTION (YouTube - More Reliable)
// ----------------------------------------------
function searchAndDownload(query, outputPath, type = 'video') {
    return new Promise((resolve, reject) => {
        // Use YouTube search as it's the most reliable
        const searchUrl = `ytsearch:${query}`;
        const typeArg = type === 'audio' ? 'bestaudio --extract-audio --audio-format mp3' : 'bestvideo+bestaudio --merge-output-format mp4';
        const command = `yt-dlp -f ${typeArg} --no-check-certificate --no-playlist --max-downloads 1 -o "${outputPath}" "${searchUrl}"`;

        console.log(`🔍 Searching for: ${query}`);
        console.log(`🔍 Running: ${command}`);

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Search failed: ${stderr}`);
                reject(new Error(`No results found for "${query}". Try using .dl with a direct link.`));
            } else {
                console.log(`✅ Download complete: ${outputPath}`);
                resolve(outputPath);
            }
        });
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
    // 📝 .task
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
                reply: `❌ Failed to generate assignment. Please try again in a few minutes.`
            });
        }
    }

    // ----------------------------------------------
    // 📖 .assist (FIXED - Complete Command List)
    // ----------------------------------------------
    if (message === '.assist') {
        const helpText = `📖 *with-us AI - Command List*\n\n` +
            `┌──────────────────────────────────────────────┐\n` +
            `│ 🎵 MEDIA DOWNLOAD                         │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ .search <title>  - Search and download    │\n` +
            `│ .dl <URL>        - Download any platform  │\n` +
            `│ .play <song>     - Download audio (MP3)   │\n` +
            `│ .vid <video>     - Download video (MP4)   │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ 📝 AI ASSIGNMENT WRITER                    │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ .task <topic> <field> <pages> <citations> │\n` +
            `│   Example: .task AI in Healthcare CompSci 4 yes │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ 💬 GROUP CHAT                             │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ .me <message>    - Send to all users      │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ 👤 USEFUL COMMANDS                         │\n` +
            `├──────────────────────────────────────────────┤\n` +
            `│ .developer  - About the developer         │\n` +
            `│ .id         - Your profile & ID           │\n` +
            `│ .users      - All users (Admin only)      │\n` +
            `│ .upgrade    - Upgrade user (Admin only)   │\n` +
            `│ .broadcast  - Announcement (Admin only)   │\n` +
            `└──────────────────────────────────────────────┘`;
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
                `🤖 *Bot:* with-us AI`
        });
    }

    // ----------------------------------------------
    // 🎵 .search
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
                reply: `❌ ${error.message}\n\n💡 Try a different search term or use .dl with a direct link.`
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
        reply: `❌ Unknown command. Type .assist to see all commands.`
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
    console.log(`🤖 Hugging Face AI: ✅ Set`);
    console.log(`🔍 Search Engine: ✅ Active`);
});
