FROM node:18-slim

# Install system deps: curl + ffmpeg (yt-dlp likes having ffmpeg)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       curl \
       ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp from the official release binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

# Workdir
WORKDIR /app

# Install Node deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy app code
COPY . .

# Railway will set PORT, fall back to 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
