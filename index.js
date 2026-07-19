const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const makeWASocket = require('@arceos/baileys').default;
const { useMultiFileAuthState } = require('@arceos/baileys');
const { DisconnectReason } = require('@arceos/baileys');

// ----------------------------------------------
// 📌 CONFIGURATION - CHANGE THIS ONE LINE!
// Replace with YOUR WhatsApp number (country code + number, NO plus sign, NO @s.whatsapp.net)
// Example: +265891011842 -> '265891011842'
// ----------------------------------------------
const ADMIN_NUMBER = '265891011842'; // <--- CHANGE THIS TO YOUR NUMBER

// ----------------------------------------------
// 🤖 BOT IDENTITY
// ----------------------------------------------
const BOT_NAME = 'with-us AI';
const DEVELOPER_NAME = 'Emmanuel Chimombo';
const DEVELOPER_TITLE = 'Full Stack System and Online Applications Developer';
const DEVELOPER_EDUCATION = 'ICT Student, Mzuzu University';

// ----------------------------------------------
// 📂 FOLDERS
// ----------------------------------------------
const TEMP_DIR = './temp_downloads/';
const SESSION_DIR = './session/';

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

// ----------------------------------------------
// 📂 DATABASE (For freemium limits)
// ----------------------------------------------
const DB_PATH = './database.json';

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
// 🌐 EXPRESS SERVER (Health checks)
// ----------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('Bot is running'));

app.listen(PORT, () => {
    console.log(`✅ HTTP server running on port ${PORT}`);
});

// ----------------------------------------------
// 🛠️ DOWNLOAD ENGINE
// ----------------------------------------------
function downloadMedia(url, outputPath, type = 'audio') {
    return new Promise((resolve, reject) => {
        let command;
        if (type === 'audio') {
            command = `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${outputPath}" "${url}"`;
        } else {
            command = `yt-dlp -f bestvideo+bestaudio --merge-output-format mp4 -o "${outputPath}" "${url}"`;
        }

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`yt-dlp error: ${stderr}`);
                reject(new Error('Download failed.'));
            } else {
                resolve(outputPath);
            }
        });
    });
}

// ----------------------------------------------
// 🚀 BAILETS WHATSAPP CLIENT
// ----------------------------------------------
let sock = null;
let pairingCodeRequested = false;

async function startBot() {
    // Load authentication state
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    // Create socket
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // QR fallback if pairing fails
        browser: ['Chrome (Linux)', 'Chrome', '120.0.0.0'],
        markOnlineOnConnect: true,
        syncFullHistory: false,
    });

    // Event: Connection update
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('📲 QR CODE GENERATED!');
            console.log('📲 Scan with WhatsApp → Linked Devices → Link a Device');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ Connection closed. Reconnecting: ${shouldReconnect}`);
            if (shouldReconnect) {
                pairingCodeRequested = false;
                startBot();
            } else {
                console.log('❌ Logged out. Delete session folder and restart.');
            }
        }

        if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} is ONLINE!`);
            console.log(`👑 Admin: ${ADMIN_NUMBER}@s.whatsapp.net`);
            console.log(`📢 Users get 4 free downloads.`);

            // Send a welcome message to yourself (optional)
            try {
                await sock.sendMessage(`${ADMIN_NUMBER}@s.whatsapp.net`, { 
                    text: `✅ ${BOT_NAME} is online! Send .assist for commands.` 
                });
            } catch (err) {
                console.log('Could not send welcome message (normal).');
            }

            // Request pairing code after connection opens
            if (!pairingCodeRequested) {
                pairingCodeRequested = true;
                setTimeout(async () => {
                    try {
                        const code = await sock.requestPairingCode(ADMIN_NUMBER);
                        console.log(`📱 PAIRING CODE: ${code}`);
                        console.log(`📱 Open WhatsApp → Settings → Linked Devices → Link with Phone Number → Enter: ${code}`);
                    } catch (err) {
                        console.log('❌ Could not generate pairing code. Use QR code instead.');
                    }
                }, 3000);
            }
        }
    });

    // Event: Credentials updated (save session)
    sock.ev.on('creds.update', saveCreds);

    // Event: Incoming messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid; // e.g., 265891011842@s.whatsapp.net
        const senderNumber = sender.split('@')[0];
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        if (!body) return;

        console.log(`📩 From ${senderNumber}: ${body}`);

        // ----------------------------------------------
        // 🧠 FALLBACK: Non-command replies with bot profile
        // ----------------------------------------------
        if (!body.startsWith('.')) {
            const profileReply = `🤖 *${BOT_NAME}*\n\n` +
                `👨‍💻 *Developer:* ${DEVELOPER_NAME}\n` +
                `💼 *Title:* ${DEVELOPER_TITLE}\n` +
                `🎓 *Education:* ${DEVELOPER_EDUCATION}\n\n` +
                `📌 *Type .assist* to see all available commands.`;
            await sock.sendMessage(sender, { text: profileReply });
            return;
        }

        // ----------------------------------------------
        // 👑 ADMIN: .upgrade <userId> <days>
        // ----------------------------------------------
        if (body.startsWith('.upgrade ') && senderNumber === ADMIN_NUMBER) {
            const parts = body.split(' ');
            if (parts.length === 3) {
                const targetUser = parts[1];
                const days = parseInt(parts[2]);
                if (!isNaN(days) && days > 0) {
                    const db = loadDB();
                    // Ensure target user has @s.whatsapp.net
                    const targetId = targetUser.includes('@') ? targetUser : targetUser + '@s.whatsapp.net';
                    if (!db.users[targetId]) db.users[targetId] = { count: 0 };
                    db.users[targetId].premium = true;
                    db.users[targetId].expiry = Date.now() + (days * 24 * 60 * 60 * 1000);
                    saveDB(db);
                    await sock.sendMessage(sender, { text: `✅ User ${targetId} upgraded for ${days} days!` });
                } else {
                    await sock.sendMessage(sender, { text: '❌ Invalid days. Usage: .upgrade <userId> <days>' });
                }
            } else {
                await sock.sendMessage(sender, { text: '❌ Usage: .upgrade <userId> <days>' });
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
            await sock.sendMessage(sender, { text: helpText });
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
            await sock.sendMessage(sender, { text: devText });
            return;
        }

        // ----------------------------------------------
        // 🎵 COMMAND: .play <song name>
        // ----------------------------------------------
        if (body.startsWith('.play ')) {
            const query = body.slice(6);
            const db = loadDB();
            if (!db.users[sender]) db.users[sender] = { count: 0 };
            const user = db.users[sender];
            const isPremium = user.premium && user.expiry > Date.now();

            if (!isPremium && user.count >= 4) {
                await sock.sendMessage(sender, {
                    text: `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                        `🆔 *Your User ID:* ${sender}\n` +
                        `👑 Admin command: .upgrade ${senderNumber} 30`
                });
                return;
            }

            await sock.sendMessage(sender, {
                text: `⏳ Searching for "${query}"... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`
            });

            try {
                const filePath = path.join(TEMP_DIR, `${Date.now()}.mp3`);
                await downloadMedia(`ytsearch:${query}`, filePath, 'audio');

                const audioBuffer = fs.readFileSync(filePath);
                await sock.sendMessage(sender, {
                    audio: audioBuffer,
                    mimetype: 'audio/mp4',
                    fileName: `${query}.mp3`
                });

                fs.unlinkSync(filePath);
                if (!isPremium) {
                    user.count += 1;
                    saveDB(db);
                }
            } catch (error) {
                await sock.sendMessage(sender, { text: '❌ Error: Song not found or download failed.' });
                console.error(error);
            }
            return;
        }

        // ----------------------------------------------
        // 🎬 COMMAND: .vid <video name>
        // ----------------------------------------------
        if (body.startsWith('.vid ')) {
            const query = body.slice(5);
            const db = loadDB();
            if (!db.users[sender]) db.users[sender] = { count: 0 };
            const user = db.users[sender];
            const isPremium = user.premium && user.expiry > Date.now();

            if (!isPremium && user.count >= 4) {
                await sock.sendMessage(sender, {
                    text: `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                        `🆔 *Your User ID:* ${sender}\n` +
                        `👑 Admin command: .upgrade ${senderNumber} 30`
                });
                return;
            }

            await sock.sendMessage(sender, {
                text: `⏳ Searching for video "${query}"... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`
            });

            try {
                const filePath = path.join(TEMP_DIR, `${Date.now()}.mp4`);
                await downloadMedia(`ytsearch:${query}`, filePath, 'video');

                const stats = fs.statSync(filePath);
                const fileSizeMB = stats.size / (1024 * 1024);

                if (fileSizeMB > 64) {
                    await sock.sendMessage(sender, { text: `❌ Video is too large (${fileSizeMB.toFixed(1)}MB). WhatsApp limit is 64MB.` });
                    fs.unlinkSync(filePath);
                    return;
                }

                const videoBuffer = fs.readFileSync(filePath);
                await sock.sendMessage(sender, {
                    video: videoBuffer,
                    mimetype: 'video/mp4',
                    fileName: `${query}.mp4`
                });

                fs.unlinkSync(filePath);
                if (!isPremium) {
                    user.count += 1;
                    saveDB(db);
                }
            } catch (error) {
                await sock.sendMessage(sender, { text: '❌ Error: Video not found or download failed.' });
                console.error(error);
            }
            return;
        }

        // ----------------------------------------------
        // 📹 COMMAND: .dl <URL>
        // ----------------------------------------------
        if (body.startsWith('.dl ')) {
            const url = body.slice(4).trim();
            if (!url || !url.startsWith('http')) {
                await sock.sendMessage(sender, { text: '❌ Please provide a valid URL. Example: .dl https://www.tiktok.com/@user/video/123' });
                return;
            }

            const db = loadDB();
            if (!db.users[sender]) db.users[sender] = { count: 0 };
            const user = db.users[sender];
            const isPremium = user.premium && user.expiry > Date.now();

            if (!isPremium && user.count >= 4) {
                await sock.sendMessage(sender, {
                    text: `❌ *Free Limit Reached!*\nYou have used all 4 free downloads.\n` +
                        `🆔 *Your User ID:* ${sender}\n` +
                        `👑 Admin command: .upgrade ${senderNumber} 30`
                });
                return;
            }

            await sock.sendMessage(sender, {
                text: `⏳ Downloading from URL... (${isPremium ? 'Premium' : user.count + 1 + '/4 Free'})`
            });

            try {
                const ext = '.mp4';
                const filePath = path.join(TEMP_DIR, `${Date.now()}${ext}`);
                await downloadMedia(url, filePath, 'video');

                const stats = fs.statSync(filePath);
                const fileSizeMB = stats.size / (1024 * 1024);

                if (fileSizeMB > 64) {
                    await sock.sendMessage(sender, { text: `❌ File is too large (${fileSizeMB.toFixed(1)}MB). WhatsApp limit is 64MB.` });
                    fs.unlinkSync(filePath);
                    return;
                }

                const extName = path.extname(filePath).toLowerCase() || '.mp4';
                const fileBuffer = fs.readFileSync(filePath);

                if (['.mp4', '.webm', '.mkv', '.avi', '.mov'].includes(extName)) {
                    await sock.sendMessage(sender, {
                        video: fileBuffer,
                        mimetype: 'video/mp4',
                        fileName: `video_${Date.now()}${extName}`
                    });
                } else if (['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.pptx'].includes(extName)) {
                    await sock.sendMessage(sender, {
                        document: fileBuffer,
                        mimetype: 'application/octet-stream',
                        fileName: `file_${Date.now()}${extName}`
                    });
                } else {
                    await sock.sendMessage(sender, {
                        document: fileBuffer,
                        mimetype: 'application/octet-stream',
                        fileName: `download_${Date.now()}${extName}`
                    });
                }

                fs.unlinkSync(filePath);
                if (!isPremium) {
                    user.count += 1;
                    saveDB(db);
                }
            } catch (error) {
                await sock.sendMessage(sender, { text: '❌ Failed to download from that URL. It might be private, unsupported, or invalid.' });
                console.error(error);
            }
            return;
        }
    });

    return sock;
}

// ----------------------------------------------
// ▶️ START THE BOT
// ----------------------------------------------
console.log('🚀 Starting bot...');
console.log('📱 Pairing code will appear in logs after connection.');
startBot().catch(console.error);
