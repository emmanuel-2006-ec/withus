const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const { exec } = require('child_process');
const path = require('path');

// ----------------------------------------------
// 📌 CONFIGURATION - CHANGE THIS ONE LINE!
// Replace with YOUR WhatsApp number (country code + number, NO plus sign).
// Example: +265891011842 -> '265891011842@c.us'
// ----------------------------------------------
const ADMIN_NUMBER = '265891011842@c.us'; // <--- CHANGE THIS

// ----------------------------------------------
// 🤖 BOT IDENTITY
// ----------------------------------------------
const BOT_NAME = 'with-us AI';
const DEVELOPER_NAME = 'Emmanuel Chimombo';
const DEVELOPER_TITLE = 'Full Stack System and Online Applications Developer';
const DEVELOPER_EDUCATION = 'ICT Student, Mzuzu University';

// ----------------------------------------------
// 📂 DATABASE HANDLING
// ----------------------------------------------
const DB_PATH = './database.json';
const TEMP_DIR = './temp_downloads/';

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

function loadDB() {
    if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH));
    }
    return { users: {} };
}

function saveDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ----------------------------------------------
// 🌐 HTTP SERVER (Keeps Render awake & handles QR)
// ----------------------------------------------
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Store QR code temporarily
let currentQR = null;

app.get('/', (req, res) => {
    res.status(200).send('OK');
});

app.get('/health', (req, res) => {
    res.status(200).send('Bot is running');
});

// 🆕 WEB QR CODE ROUTE - Visit this URL to see the QR code!
app.get('/qr', async (req, res) => {
    if (currentQR) {
        try {
            res.setHeader('Content-Type', 'image/png');
            const qrImage = await QRCode.toBuffer(currentQR);
            res.send(qrImage);
        } catch (err) {
            res.status(500).send('Error generating QR code');
        }
    } else {
        res.send('⏳ No QR code available yet. Wait for bot to initialize...');
    }
});

app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
});

// ----------------------------------------------
// 🛠️ HELPER: Download media using yt-dlp
// ----------------------------------------------
function downloadMedia(url, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        let command;
        if (type === 'audio') {
            command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${outputPath}" "${url}"`;
        } else if (type === 'video') {
            command = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 -o "${outputPath}" "${url}"`;
        } else {
            command = `yt-dlp -o "${outputPath}" "${url}"`;
        }

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlp error: ${stderr}`);
                reject(new Error('Failed to download media. Check the URL or try again.'));
            } else {
                resolve(outputPath);
            }
        });
    });
}

// ----------------------------------------------
// 🤖 BOT CLIENT
// ----------------------------------------------
console.log('🚀 Starting bot client...');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        headless: true, 
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

console.log('✅ Client created, waiting for QR code...');

client.on('qr', qr => {
    currentQR = qr; // Store for web route
    console.log('📲 QR CODE GENERATED!');
    qrcode.generate(qr, { small: true });
    console.log('📲 OR visit: https://your-bot.onrender.com/qr to see QR code as image!');
});

client.on('authenticated', () => {
    console.log('✅ Authenticated successfully!');
});

client.on('auth_failure', msg => {
    console.error('❌ Authentication failed:', msg);
});

client.on('ready', () => {
    console.log(`✅ ${BOT_NAME} is ONLINE!`);
    console.log('👑 Admin:', ADMIN_NUMBER);
    console.log('📢 Users get 4 free downloads.');
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot disconnected:', reason);
});

client.on('message_create', async (message) => {
    if (message.fromMe) return;
    const userId = message.author || message.from;
    const db = loadDB();
    const body = message.body.trim();

    // ----------------------------------------------
    // 🧠 FALLBACK: Non-command replies with bot profile
    // ----------------------------------------------
    if (!body.startsWith('.')) {
        const profileReply = `🤖 *${BOT_NAME}*\n\n` +
            `👨‍💻 *Developer:* ${DEVELOPER_NAME}\n` +
            `💼 *Title:* ${DEVELOPER_TITLE}\n` +
            `🎓 *Education:* ${DEVELOPER_EDUCATION}\n\n` +
            `📌 *Type .assist* to see all available commands.`;
        await message.reply(profileReply);
        return;
    }

    // ----------------------------------------------
    // 👑 ADMIN: .upgrade <userId> <days>
    // ----------------------------------------------
    if (body.startsWith('.upgrade ') && userId === ADMIN_NUMBER) {
        const parts = body.split(' ');
        if (parts.length === 3) {
            const targetUser = parts[1];
            const days = parseInt(parts[2]);
            if (!isNaN(days) && days > 0) {
                if (!db.users[targetUser]) db.users[targetUser] = { count: 0 };
                db.users[targetUser].premium = true;
                db.users[targetUser].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                saveDB(db);
                await message.reply(`✅ User ${targetUser} upgraded successfully for ${days} days!`);
            } else {
                await message.reply('❌ Invalid days. Usage: .upgrade <userId> <days>');
            }
        } else {
            await message.reply('❌ Usage: .upgrade <userId> <days>');
        }
        return;
    }

    // ----------------------------------------------
    // ℹ️ COMMAND: .assist
    // ----------------------------------------------
    if (body === '.assist') {
        const helpText = `📖 *${BOT_NAME} - Command List*\n\n` +
            `🎵 *.play <song name>* - Search and download audio (MP3) from YouTube.\n` +
            `🎬 *.vid <video name>* - Search and download video (MP4) from YouTube (comedy, clips, etc.).\n` +
            `📹 *.dl <URL>* - Download video from Facebook, TikTok, Instagram, Twitter, etc.\n` +
            `📄 *.dl <document URL>* - Download any document (PDF, DOCX, etc.).\n` +
            `👤 *.developer* - Show developer information.\n` +
            `📊 *.assist* - Show this help menu.\n\n` +
            `🔓 *Free users get 4 downloads total.* Ask the admin to upgrade for unlimited access.`;
        await message.reply(helpText);
        return;
    }

    // ----------------------------------------------
    // 👤 COMMAND: .developer
    // ----------------------------------------------
    if (body === '.developer') {
        const devText = `👨‍💻 *Developer Profile*\n\n` +
            `📌 *Name:* ${DEVELOPER_NAME}\n` +
            `💼 *Role:* ${DEVELOPER_TITLE}\n` +
            `🎓 *Education:* ${DEVELOPER_EDUCATION}\n` +
            `🌍 *Location:* Malawi\n\n` +
            `🤖 *Bot:* ${BOT_NAME} - A multi-platform media downloader.`;
        await message.reply(devText);
        return;
    }

    // ----------------------------------------------
    // 🎵 COMMAND: .play <song name> (Audio MP3)
    // ----------------------------------------------
    if (body.startsWith('.play ')) {
        const query = body.slice(6);
        if (!db.users[userId]) {
            db.users[userId] = { count: 0 };
            saveDB(db);
        }
        const user = db.users[userId];
        const isPremium = user.premium && user.expiry > Date.now();

        if (!isPremium && user.count >= 4) {
            await message.reply(
                `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                `🆔 *Your User ID:* ${userId}\n` +
                `👑 Admin command: .upgrade ${userId} 30`
            );
            return;
        }

        await message.reply(`⏳ Searching for audio "${query}"... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`);

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
            await downloadMedia(`ytsearch:${query}`, filePath, 'audio');

            await client.sendMessage(message.from, {
                audio: fs.readFileSync(filePath),
                mimetype: 'audio/mp4',
                fileName: `${query}.mp3`
            });

            fs.unlinkSync(filePath);
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
        } catch (error) {
            await message.reply('❌ Error: Song not found or download failed.');
            console.error(error);
        }
        return;
    }

    // ----------------------------------------------
    // 🎬 COMMAND: .vid <video name> (Video MP4)
    // ----------------------------------------------
    if (body.startsWith('.vid ')) {
        const query = body.slice(5);
        if (!db.users[userId]) {
            db.users[userId] = { count: 0 };
            saveDB(db);
        }
        const user = db.users[userId];
        const isPremium = user.premium && user.expiry > Date.now();

        if (!isPremium && user.count >= 4) {
            await message.reply(
                `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                `🆔 *Your User ID:* ${userId}\n` +
                `👑 Admin command: .upgrade ${userId} 30`
            );
            return;
        }

        await message.reply(`⏳ Searching for video "${query}"... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`);

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await downloadMedia(`ytsearch:${query}`, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                await message.reply(`❌ Video is too large (${fileSizeMB.toFixed(1)}MB). WhatsApp limit is 64MB.`);
                fs.unlinkSync(filePath);
                return;
            }

            await client.sendMessage(message.from, {
                video: fs.readFileSync(filePath),
                mimetype: 'video/mp4',
                fileName: `${query}.mp4`
            });

            fs.unlinkSync(filePath);
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
        } catch (error) {
            await message.reply('❌ Error: Video not found or download failed.');
            console.error(error);
        }
        return;
    }

    // ----------------------------------------------
    // 📹 COMMAND: .dl <URL> (Video/Document from link)
    // ----------------------------------------------
    if (body.startsWith('.dl ')) {
        const url = body.slice(4).trim();
        if (!url || !url.startsWith('http')) {
            await message.reply('❌ Please provide a valid URL. Example: .dl https://www.tiktok.com/@user/video/123');
            return;
        }

        if (!db.users[userId]) {
            db.users[userId] = { count: 0 };
            saveDB(db);
        }
        const user = db.users[userId];
        const isPremium = user.premium && user.expiry > Date.now();

        if (!isPremium && user.count >= 4) {
            await message.reply(
                `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                `🆔 *Your User ID:* ${userId}\n` +
                `👑 Admin command: .upgrade ${userId} 30`
            );
            return;
        }

        await message.reply(`⏳ Downloading from URL... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`);

        try {
            const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
            await downloadMedia(url, filePath, 'video');

            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);

            if (fileSizeMB > 64) {
                await message.reply(`❌ File is too large (${fileSizeMB.toFixed(1)}MB). WhatsApp limit is 64MB.`);
                fs.unlinkSync(filePath);
                return;
            }

            const extName = path.extname(filePath).toLowerCase() || '.mp4';
            const finalPath = filePath;

            if (['.mp4', '.webm', '.mkv', '.avi', '.mov'].includes(extName)) {
                await client.sendMessage(message.from, {
                    video: fs.readFileSync(finalPath),
                    mimetype: 'video/mp4',
                    fileName: `video_${Date.now()}${extName}`
                });
            } else if (['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.pptx'].includes(extName)) {
                await client.sendMessage(message.from, {
                    document: fs.readFileSync(finalPath),
                    mimetype: 'application/octet-stream',
                    fileName: `file_${Date.now()}${extName}`
                });
            } else {
                await client.sendMessage(message.from, {
                    document: fs.readFileSync(finalPath),
                    mimetype: 'application/octet-stream',
                    fileName: `download_${Date.now()}${extName}`
                });
            }

            fs.unlinkSync(finalPath);
            if (!isPremium) {
                user.count += 1;
                saveDB(db);
            }
        } catch (error) {
            await message.reply('❌ Failed to download from that URL. It might be private, unsupported, or invalid.');
            console.error(error);
        }
        return;
    }
});

client.initialize();
