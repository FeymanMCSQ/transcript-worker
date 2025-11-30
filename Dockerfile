# Use an official Node image
FROM node:18-slim

# Install yt-dlp + ffmpeg (needed for some transcripts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
 && pip3 install yt-dlp \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy package.json and install dependencies first (faster rebuilds)
COPY package*.json ./
RUN npm install --production

# Copy the rest of your code
COPY . .

# Railway expects a PORT env var
ENV PORT=8080

# Expose port
EXPOSE 8080

# Start the worker
CMD ["node", "index.js"]
