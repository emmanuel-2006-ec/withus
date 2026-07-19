FROM node:18-slim

# Install FFmpeg and yt-dlp (with upgrade)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install and UPGRADE yt-dlp to latest version
RUN pip3 install --upgrade yt-dlp --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
