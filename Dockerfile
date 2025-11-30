FROM node:18-slim

# Install yt-dlp + ffmpeg (needed for captions)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ffmpeg \
       yt-dlp \
  && rm -rf /var/lib/apt/lists/*

# Set working dir
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Expose port Railway expects (matches your code)
EXPOSE 8080

CMD ["node", "index.js"]
