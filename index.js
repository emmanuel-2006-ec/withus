const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// ----------------------------------------------
// 📌 CONFIGURATION
// ----------------------------------------------
const ADMIN_NAME = 'Emmanuel'; // <--- CHANGE THIS TO YOUR NAME
const ADMIN_ID = null;

// ----------------------------------------------
// 📂 SETUP
// ----------------------------------------------
const TEMP_DIR = './temp_downloads/';
const DB_PATH = './database.json';

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// ----------------------------------------------
// 📂 DATABASE
// ----------------------------------------------
function loadDB() {
    if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH));
    }
    return { users: {}, announcements: [] };
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ----------------------------------------------
// 🛠️ DOWNLOAD FUNCTION (WITH COOKIES)
// ----------------------------------------------
function downloadMedia(url, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        // Check if cookies file exists
        const cookieOption = fs.existsSync('./cookies.txt') ? '--cookies ./cookies.txt' : '';
        if (!cookieOption) {
            console.warn('⚠️ cookies.txt not found! YouTube may block requests.');
        }
        
        let command;
        if (type === 'audio') {
            command = `yt-dlp ${cookieOption} -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "${outputPath}" "${url}"`;
        } else {
            command = `yt-dlp ${cookieOption} -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${outputPath}" "${url}"`;
        }

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
// 🛠️ SEARCH FUNCTION (WITH COOKIES)
// ----------------------------------------------
function searchMedia(query, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        // ✅ ALWAYS use cookies for search too
        const cookieOption = fs.existsSync('./cookies.txt') ? '--cookies ./cookies.txt' : '';
        if (!cookieOption) {
            console.warn('⚠️ cookies.txt not found! YouTube may block requests.');
        }

        const sources = [
            { name: 'TikTok', prefix: `tiksearch:${query}` },
            { name: 'Dailymotion', prefix: `dmsearch:${query}` },
            { name: 'YouTube (Mobile)', prefix: `ytsearch${query}` }
        ];

        let currentIndex = 0;

        function tryNextSource() {
            if (currentIndex >= sources.length) {
                return reject(new Error(`No results found for "${query}". Try using .dl with a direct link.`));
            }

            const source = sources[currentIndex];
            currentIndex++;
            console.log(`🔍 Searching ${source.name} for: ${query}`);

            let command;
            if (type === 'audio') {
                command = `yt-dlp ${cookieOption} -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
            } else {
                command = `yt-dlp ${cookieOption} -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
            }

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
    } else {
        if (username && db.users[userKey].username !== username) {
            db.users[userKey].username = username;
            saveDB(db);
        }
    }

    const user = db.users[userKey];
    const isPremium = user.premium && user.expiry > Date.now();

    // ----------------------------------------------
    // 🧠 NON-COMMAND
    // ----------------------------------------------
    if (!message.startsWith('.')) {
        const remaining = isPremium ? '♾️ Unlimited' : Math.max(0, 4 - user.count);
        const reply = `🤖 *with-us AI*\n\n` +
            `👤 *User:* ${user.username || 'User'}\n` +
            `🆔 *Your ID:* ${userKey}\n\n` +
            `👨‍💻 *Developer:* Emmanuel Chimombo\n` +
            `💼 *Title:* Full Stack System and Online Applications Developer\n` +
            `🎓 *Education:* ICT Student, Mzuzu University\n\n` +
            `📌 *Type .assist* to see all commands.\n` +
            `📊 *Free downloads left:* ${remaining}`;
        return res.json({ reply });
    }

    // ----------------------------------------------
    // 👑 ADMIN: .users
    // ----------------------------------------------
    if (message === '.users' && isAdmin) {
        const users = db.users;
        const userList = Object.keys(users).map(key => {
            const u = users[key];
            const premium = u.premium && u.expiry > Date.now() ? '✅ Premium' : '❌ Free';
            const remaining = premium === '✅ Premium' ? '♾️' : Math.max(0, 4 - u.count);
            return `• *${u.username || 'User'}* (${key})\n  ${premium} | ${remaining} downloads left`;
        }).join('\n\n');

        const reply = `📊 *Registered Users (${Object.keys(users).length})*\n\n${userList || 'No users yet.'}`;
        return res.json({ reply });
    }

    // ----------------------------------------------
    // 👤 .id
    // ----------------------------------------------
    if (message === '.id') {
        const remaining = isPremium ? '♾️ Unlimited' : Math.max(0, 4 - user.count);
        const reply = `👤 *Your Profile*\n\n` +
            `📌 *Username:* ${user.username || 'User'}\n` +
            `🆔 *User ID:* ${userKey}\n` +
            `📊 *Downloads left:* ${remaining}\n` +
            `👑 *Admin:* ${isAdmin ? '✅ Yes' : '❌ No'}`;
        return res.json({ reply });
    }

    // ----------------------------------------------
    // 👑 ADMIN: .broadcast
    // ----------------------------------------------
    if (message.startsWith('.broadcast ') && isAdmin) {
        const broadcastMsg = message.slice(11).trim();
        if (!broadcastMsg) {
            return res.json({ reply: '❌ Please provide a message to broadcast.' });
        }
        if (!db.announcements) db.announcements = [];
        const announcement = {
            from: '📢 Admin',
            message: broadcastMsg,
            time: new Date().toISOString(),
            id: Date.now()
        };
        db.announcements.push(announcement);
        saveDB(db);
        return res.json({
            reply: `📢 *Announcement Sent!*\n\n"${broadcastMsg}"`,
            announcement: announcement
        });
    }

    // ----------------------------------------------
    // 👑 ADMIN: .upgrade
    // ----------------------------------------------
    if (message.startsWith('.upgrade ') && isAdmin) {
        const parts = message.split(' ');
        if (parts.length === 3) {
            const targetUser = parts[1];
            const days = parseInt(parts[2]);
            if (!isNaN(days) && days > 0) {
                if (!db.users[targetUser]) {
                    return res.json({ reply: `❌ User "${targetUser}" not found. Use .users to see all users.` });
                }
                db.users[targetUser].premium = true;
                db.users[targetUser].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                saveDB(db);
                if (!db.announcements) db.announcements = [];
                const targetName = db.users[targetUser].username || targetUser;
                const announcement = {
                    from: '🎉 System',
                    message: `🎉 *${targetName}* (${targetUser}) was upgraded to Premium for ${days} days by Admin!`,
                    time: new Date().toISOString(),
                    id: Date.now()
                };
                db.announcements.push(announcement);
                saveDB(db);
                return res.json({
                    reply: `✅ ${targetName} (${targetUser}) upgraded for ${days} days!`,
                    announcement: announcement
                });
            } else {
                return res.json({ reply: '❌ Invalid days. Usage: .upgrade <userId> <days>' });
            }
        }
        return res.json({ reply: '❌ Usage: .upgrade <userId> <days>' });
    }

    // ----------------------------------------------
    // ℹ️ .assist
    // ----------------------------------------------
    if (message === '.assist') {
        const helpText = `📖 *with-us AI - Command List*\n\n` +
            `🎵 *.play <song>* - Download audio (MP3)\n` +
            `🎬 *.vid <video>* - Download video (MP4)\n` +
            `📹 *.dl <URL>* - ⭐ *BEST* Download from ANY platform (YouTube, TikTok, Facebook, Instagram, etc.)\n` +
            `👤 *.developer* - Show developer info\n` +
            `🆔 *.id* - Show your user ID\n` +
            `📊 *.assist* - Show this menu\n\n` +
            `👑 *Admin Commands:* .users, .upgrade, .broadcast`;
        return res.json({ reply: helpText });
    }

    // ----------------------------------------------
    // 👤 .developer
    // ----------------------------------------------
    if (message === '.developer') {
        const devText = `👨‍💻 *Developer Profile*\n\n` +
            `📌 *Name:* Emmanuel Chimombo\n` +
            `💼 *Role:* Full Stack System and Online Applications Developer\n` +
            `🎓 *Education:* ICT Student, Mzuzu University\n` +
            `🌍 *Location:* Malawi\n\n` +
            `🤖 *Bot:* with-us AI - Universal Media Downloader.`;
        return res.json({ reply: devText });
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
            await searchMedia(query, filePath, 'audio');

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `${query}.mp3`,
                file: base64File,
                mimeType: 'audio/mpeg',
                reply: `✅ *${query}* - Downloaded!`
            });
        } catch (error) {
            console.error('Play error:', error);
            return res.json({ reply: `❌ ${error.message || 'Could not find or download.'}` });
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
            await searchMedia(query, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                fs.unlinkSync(filePath);
                return res.json({ reply: `❌ Video too large (${fileSizeMB.toFixed(1)}MB). Limit is 64MB.` });
            }

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `${query}.mp4`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ *${query}* - Downloaded!`
            });
        } catch (error) {
            console.error('Video error:', error);
            return res.json({ reply: `❌ ${error.message || 'Could not find or download.'}` });
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
            await downloadMedia(url, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                fs.unlinkSync(filePath);
                return res.json({ reply: `❌ File too large (${fileSizeMB.toFixed(1)}MB). Limit is 64MB.` });
            }

            const fileBuffer = fs.readFileSync(filePath);
            const base64File = fileBuffer.toString('base64');
            
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
            fs.unlinkSync(filePath);

            return res.json({
                action: 'download',
                filename: `video_${Date.now()}.mp4`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ Download complete!`
            });
        } catch (error) {
            console.error('DL error:', error);
            return res.json({ reply: `❌ Failed to download: ${error.message}` });
        }
    }

    // ----------------------------------------------
    // UNKNOWN COMMAND
    // ----------------------------------------------
    return res.json({ reply: '❌ Unknown command. Type .assist for help.' });
});

// ----------------------------------------------
// 📢 GET ANNOUNCEMENTS
// ----------------------------------------------
app.get('/api/announcements', (req, res) => {
    const db = loadDB();
    const announcements = db.announcements || [];
    res.json({ announcements });
});

// ----------------------------------------------
// ▶️ START
// ----------------------------------------------
app.listen(PORT, () => {
    console.log(`✅ with-us AI Chat running on port ${PORT}`);
    console.log(`🌐 Open: https://withus.onrender.com`);
});
