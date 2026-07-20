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
// 📂 DATABASE FUNCTIONS
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
// 🛠️ DOWNLOAD FUNCTION (Triple-Search Engine)
// ----------------------------------------------
function downloadMedia(query, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        // Search Sources: TikTok -> Dailymotion -> YouTube (Mobile)
        const sources = [
            { 
                name: 'TikTok', 
                prefix: `tiksearch:${query}`, 
                args: '' 
            },
            { 
                name: 'Dailymotion', 
                prefix: `dmsearch:${query}`, 
                args: '' 
            },
            { 
                name: 'YouTube (Mobile)', 
                prefix: `ytsearch:${query}`, 
                args: '--extractor-args "youtube:player_client=android,mweb"' 
            }
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
                command = `yt-dlp ${source.args} -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
            } else {
                command = `yt-dlp ${source.args} -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
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
        db.announcements.push({
            from: '📢 Admin',
            message: broadcastMsg,
            time: new Date().toISOString()
        });
        saveDB(db);
        return res.json({
            reply: `📢 *Announcement Sent!*\n\n"${broadcastMsg}"\n\n✅ All users will see this.`
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
                db.announcements.push({
                    from: '🎉 System',
                    message: `🎉 *${targetName}* (${targetUser}) was upgraded to Premium for ${days} days by Admin!`,
                    time: new Date().toISOString()
                });
                saveDB(db);
                return res.json({
                    reply: `✅ ${targetName} (${targetUser}) upgraded for ${days} days!\n\n📢 Announcement sent to all users.`
                });
            } else {
                return res.json({ reply: '❌ Invalid days. Usage: .upgrade <userId> <days>' });
            }
        }
        return res.json({ reply: '❌ Usage: .upgrade <userId> <days>' });
    }

    // ----------------------------------------------
    // ℹ️ .assist (Updated with clear instructions)
    // ----------------------------------------------
    if (message === '.assist') {
        const helpText = `📖 *with-us AI - Command List*\n\n` +
            `🎵 *.play <song>* - Searches TikTok/Dailymotion/YouTube for audio (MP3).\n` +
            `🎬 *.vid <video>* - Searches TikTok/Dailymotion/YouTube for video (MP4).\n` +
            `📹 *.dl <URL>* - ⭐ *BEST OPTION* Download directly from ANY site (YouTube, TikTok, Instagram, etc.).\n` +
            `👤 *.developer* - Show developer info.\n` +
            `🆔 *.id* - Show your user ID.\n` +
            `📊 *.assist* - Show this menu.\n\n` +
            `👑 *Admin Commands:* .users, .upgrade, .broadcast\n\n` +
            `💡 *Tip:* If .play/.vid fail, use .dl with the video link (YouTube/TikTok) – it always works!`;
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
    // 🎵 .play (Now searches TikTok -> Dailymotion -> YouTube)
    // ----------------------------------------------
    if (message.startsWith('.play ')) {
        const query = message.slice(6);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\nYou've used all 4 free downloads.\n` +
                    `🆔 *Your ID:* ${userKey}\n` +
                    `👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
            await downloadMedia(query, filePath, 'audio');

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
    // 🎬 .vid (Now searches TikTok -> Dailymotion -> YouTube)
    // ----------------------------------------------
    if (message.startsWith('.vid ')) {
        const query = message.slice(5);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\nYou've used all 4 free downloads.\n` +
                    `🆔 *Your ID:* ${userKey}\n` +
                    `👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await downloadMedia(query, filePath, 'video');

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
    // 📹 .dl <URL> (BEST OPTION - ALWAYS WORKS)
    // ----------------------------------------------
    if (message.startsWith('.dl ')) {
        const url = message.slice(4).trim();
        if (!url || !url.startsWith('http')) {
            return res.json({ reply: '❌ Please provide a valid URL.' });
        }

        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\nYou've used all 4 free downloads.\n` +
                    `🆔 *Your ID:* ${userKey}\n` +
                    `👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            // Direct download uses yt-dlp with no search, just the raw URL.
            const command = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${filePath}" "${url}"`;
            console.log(`🔍 Running direct DL: ${command}`);
            
            await new Promise((resolve, reject) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error(`❌ yt-dlp error: ${stderr}`);
                        reject(new Error(stderr || error.message));
                    } else {
                        resolve(filePath);
                    }
                });
            });

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

            const ext = path.extname(url).split('?')[0] || '.mp4';
            return res.json({
                action: 'download',
                filename: `video_${Date.now()}${ext}`,
                file: base64File,
                mimeType: 'video/mp4',
                reply: `✅ Download complete!`
            });
        } catch (error) {
            console.error('DL error:', error);
            return res.json({ reply: `❌ Failed to download: ${error.message || 'URL might be private.'}` });
        }
    }

    // ----------------------------------------------
    // UNKNOWN COMMAND
    // ----------------------------------------------
    return res.json({ reply: '❌ Unknown command. Type .assist for help.' });
});

// ----------------------------------------------
// 📥 DOWNLOAD ENDPOINT (Fallback for direct browser requests)
// ----------------------------------------------
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(TEMP_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (!err) {
                setTimeout(() => {
                    try { fs.unlinkSync(filePath); } catch (e) {}
                }, 5000);
            } else {
                console.error('Download error:', err);
            }
        });
    } else {
        res.status(404).send('File not found.');
    }
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
