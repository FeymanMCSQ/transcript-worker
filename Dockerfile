FROM node:18-slim

# Install system deps: CA certs, curl, ffmpeg, python3
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       ffmpeg \
       python3 \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp from the official release binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
