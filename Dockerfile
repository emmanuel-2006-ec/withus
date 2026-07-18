FROM node:18

# Install FFmpeg, Chromium, and yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    python3 \
    python3-pip \
    yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer where to find Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy your bot code
COPY . .

# Expose port for health checks
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
