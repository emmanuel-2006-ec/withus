FROM node:18-slim

# Install FFmpeg, Chromium, AND yt-dlp (supports 1000+ sites)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    python3 \
    python3-pip \
    && pip3 install yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer where to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy your bot code
COPY . .

# Start the bot
CMD ["node", "index.js"]
