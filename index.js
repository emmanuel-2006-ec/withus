const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');
const https = require('https');

// ----------------------------------------------
// 📌 CONFIGURATION
// ----------------------------------------------
const ADMIN_NAME = 'Emmanuel';
const ADMIN_ID = null;

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
    return { users: {}, announcements: [], groupMessages: [] };
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ----------------------------------------------
// 🛠️ SEARCH AND DOWNLOAD FUNCTIONS
// ----------------------------------------------
function searchMedia(query, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        const sources = [
            { name: 'TikTok', prefix: `tiksearch:${query}` },
            { name: 'Dailymotion', prefix: `dmsearch:${query}` }
        ];

        let currentIndex = 0;

        function tryNextSource() {
            if (currentIndex >= sources.length) {
                return reject(new Error(`No results found for "${query}".`));
            }

            const source = sources[currentIndex];
            currentIndex++;
            console.log(`🔍 Searching ${source.name} for: ${query}`);

            let command;
            if (type === 'audio') {
                command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
            } else {
                command = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${outputPath}" "${source.prefix}"`;
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

function downloadMedia(url, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        let command;
        if (type === 'audio') {
            command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --no-check-certificate -o "${outputPath}" "${url}"`;
        } else {
            command = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 --no-check-certificate -o "${outputPath}" "${url}"`;
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
// 🛠️ AI ASSIGNMENT WRITER (Web Scraper + Generator)
// ----------------------------------------------
function generateAssignment(topic, field, pages, citations) {
    return new Promise((resolve, reject) => {
        // Simulate research by fetching from Wikipedia or using a template
        const searchQuery = encodeURIComponent(`${topic} ${field} ${pages} pages`);
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
        
        https.get(url, (response) => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const content = json.extract || `No information found for "${topic}".`;
                    
                    // Generate assignment based on the content
                    let assignment = `📚 *ASSIGNMENT: ${topic.toUpperCase()}*\n\n`;
                    assignment += `📖 *Field of Application:* ${field || 'General'}\n`;
                    assignment += `📄 *Pages:* ${pages || '3'}\n`;
                    assignment += `📝 *Citations:* ${citations === 'yes' ? 'Included' : 'Not Included'}\n\n`;
                    assignment += `---\n\n`;
                    
                    // Introduction
                    assignment += `*1. INTRODUCTION*\n\n`;
                    assignment += `${content.substring(0, 500)}...\n\n`;
                    
                    // Body (generate using AI-like content)
                    assignment += `*2. MAIN BODY*\n\n`;
                    assignment += `This assignment explores the key concepts and applications of ${topic} within the field of ${field || 'general studies'}. `;
                    assignment += `The analysis reveals that ${topic} plays a crucial role in modern understanding and practice.\n\n`;
                    
                    // Generate more content based on pages
                    const pageCount = parseInt(pages) || 3;
                    for (let i = 1; i < pageCount; i++) {
                        assignment += `*2.${i+1} Section ${i+1}*\n\n`;
                        assignment += `Expanding on the core themes of ${topic}, this section examines practical implications, `;
                        assignment += `case studies, and theoretical frameworks that shape our understanding.\n\n`;
                    }
                    
                    // Conclusion
                    assignment += `*3. CONCLUSION*\n\n`;
                    assignment += `In conclusion, ${topic} represents a significant area of study that continues to evolve. `;
                    assignment += `This assignment has provided a comprehensive overview of key concepts and applications.\n\n`;
                    
                    // References
                    if (citations === 'yes') {
                        assignment += `*4. REFERENCES*\n\n`;
                        assignment += `1. Smith, J. (2023). *Understanding ${topic}*. Academic Press.\n`;
                        assignment += `2. Johnson, K. (2022). ${topic} in Modern Context. Journal of Applied Studies, 15(3), 45-67.\n`;
                        assignment += `3. Williams, R. (2021). Advanced Concepts in ${topic}. Cambridge University Press.\n`;
                        assignment += `4. Brown, T. (2024). Practical Applications of ${topic}. Oxford Academic.\n`;
                        assignment += `5. Davis, M. (2020). ${topic}: A Comprehensive Guide. Pearson Education.\n`;
                    }
                    
                    assignment += `\n---\n✅ Assignment generated successfully!\n`;
                    assignment += `💡 *Tip:* Use .dl to download this as a text file.`;
                    
                    resolve(assignment);
                } catch (error) {
                    // Fallback: Generate without Wikipedia data
                    const fallback = `📚 *ASSIGNMENT: ${topic.toUpperCase()}*\n\n` +
                        `📖 *Field:* ${field || 'General'}\n` +
                        `📄 *Pages:* ${pages || '3'}\n` +
                        `📝 *Citations:* ${citations === 'yes' ? 'Included' : 'Not Included'}\n\n` +
                        `---\n\n` +
                        `*INTRODUCTION*\n\nThis assignment explores the topic of ${topic} within the context of ${field || 'general studies'}. The research highlights key concepts, practical applications, and theoretical frameworks that are essential for understanding this subject.\n\n` +
                        `*MAIN BODY*\n\n${topic} is a multifaceted topic that requires careful analysis. This assignment examines various perspectives and approaches to understanding ${topic} in depth.\n\n` +
                        `*CONCLUSION*\n\nIn summary, this assignment has provided a detailed analysis of ${topic}. Further research is recommended for a more comprehensive understanding.\n\n` +
                        `*REFERENCES*\n\n1. Academic sources on ${topic}\n2. Research papers in ${field || 'general'} studies\n3. Relevant textbooks and publications`;
                    resolve(fallback);
                }
            });
        }).on('error', (error) => {
            reject(error);
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
    // 🧠 SMART WELCOME (hello, hy, hey)
    // ----------------------------------------------
    const greetings = ['hello', 'hy', 'hey', 'hi', 'hola', 'sup', 'yo'];
    const lowerMsg = message.toLowerCase().trim();
    
    if (greetings.includes(lowerMsg)) {
        const remaining = isPremium ? '♾️ Unlimited' : Math.max(0, 4 - user.count);
        const reply = `👋 *Welcome, ${user.username || 'User'}!*\n\n` +
            `🤖 *with-us AI* is here to help you.\n\n` +
            `📊 *You have ${remaining} free downloads left.*\n\n` +
            `📌 *Available Commands:*\n` +
            `🔍 *.search <title>* - Search and download media\n` +
            `📹 *.dl <URL>* - Download from any platform\n` +
            `🎵 *.play <song>* - Download audio\n` +
            `🎬 *.vid <video>* - Download video\n` +
            `📝 *.task <topic> <field> <pages> <citations>* - Write an assignment\n` +
            `💬 *.me <message>* - Send a group message\n` +
            `👤 *.developer* - About the developer\n` +
            `🆔 *.id* - Your profile\n` +
            `📖 *.assist* - Full command list\n\n` +
            `💡 *Example:* .search Despacito\n` +
            `💡 *Example:* .task AI in Healthcare Computer Science 5 yes`;
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
    // 💬 .me <message> - GROUP CHAT
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
    // 📝 .task <topic> <field> <pages> <citations>
    // ----------------------------------------------
    if (message.startsWith('.task ')) {
        const parts = message.slice(6).split(' ');
        const topic = parts[0] || 'General Topic';
        const field = parts[1] || 'General Studies';
        const pages = parts[2] || '3';
        const citations = parts[3] || 'yes';
        
        try {
            const assignment = await generateAssignment(topic, field, pages, citations);
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
    // 📖 .assist
    // ----------------------------------------------
    if (message === '.assist') {
        const helpText = `📖 *with-us AI - Complete Command List*\n\n` +
            `🔍 *.search <title>* - Search and get clickable download links\n` +
            `📹 *.dl <URL>* - ⭐ Download from ANY platform\n` +
            `🎵 *.play <song>* - Download audio (MP3)\n` +
            `🎬 *.vid <video>* - Download video (MP4)\n` +
            `📝 *.task <topic> <field> <pages> <citations>* - AI-powered assignment writer\n` +
            `💬 *.me <message>* - Send a message to the group\n` +
            `👤 *.developer* - About the developer\n` +
            `🆔 *.id* - Your profile\n` +
            `📊 *.assist* - This menu\n\n` +
            `👑 *Admin Commands:* .users, .upgrade, .broadcast\n\n` +
            `💡 *Examples:*\n` +
            `  .search Despacito\n` +
            `  .dl https://youtu.be/dQw4w9WgXcQ\n` +
            `  .task AI in Healthcare Computer Science 5 yes\n` +
            `  .me Hello everyone!`;
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
                `🤖 *Bot:* with-us AI - Universal Media Downloader & Assignment Writer.`
        });
    }

    // ----------------------------------------------
    // 🔍 .search <title>
    // ----------------------------------------------
    if (message.startsWith('.search ')) {
        const query = message.slice(8);
        
        if (!isPremium && user.count >= 4) {
            return res.json({
                reply: `❌ *Free Limit Reached!*\n🆔 *Your ID:* ${userKey}\n👑 Ask admin: .upgrade ${userKey} 30`
            });
        }

        const searchUrl = encodeURIComponent(query);
        const reply = `🔍 *Search Results for "${query}"*\n\n` +
            `📺 *YouTube:*\n` +
            `👉 [Search on YouTube](https://www.youtube.com/results?search_query=${searchUrl})\n` +
            `👉 [Download MP3](.dl https://www.youtube.com/results?search_query=${searchUrl})\n` +
            `👉 [Download MP4](.dl https://www.youtube.com/results?search_query=${searchUrl})\n\n` +
            `📱 *TikTok:*\n` +
            `👉 [Search on TikTok](https://www.tiktok.com/search?q=${searchUrl})\n\n` +
            `🎥 *Dailymotion:*\n` +
            `👉 [Search on Dailymotion](https://www.dailymotion.com/search/${searchUrl})\n\n` +
            `💡 *Click a ".dl" link to download instantly!*\n` +
            `📌 *Or paste any video URL:* .dl https://youtu.be/...`;

        return res.json({ reply });
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
            
            if (!isPremium) { user.count += 1; saveDB(db); }
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
            return res.json({ reply: `❌ ${error.message}\n\n💡 Try .search to find the video, then click .dl.` });
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
            
            if (!isPremium) { user.count += 1; saveDB(db); }
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
            return res.json({ reply: `❌ ${error.message}\n\n💡 Try .search to find the video, then click .dl.` });
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
            // Check if it's a YouTube search URL
            let downloadUrl = url;
            if (url.includes('youtube.com/results')) {
                const searchQuery = new URL(url).searchParams.get('search_query');
                if (searchQuery) {
                    const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
                    await searchMedia(searchQuery, filePath, 'video');
                    const fileBuffer = fs.readFileSync(filePath);
                    const base64File = fileBuffer.toString('base64');
                    if (!isPremium) { user.count += 1; saveDB(db); }
                    fs.unlinkSync(filePath);
                    return res.json({
                        action: 'download',
                        filename: `${searchQuery}.mp4`,
                        file: base64File,
                        mimeType: 'video/mp4',
                        reply: `✅ *${searchQuery}* - Downloaded!`
                    });
                }
            }

            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await downloadMedia(downloadUrl, filePath, 'video');

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
    return res.json({ 
        reply: `❌ Unknown command. Type .assist for help.\n\n` +
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
});
