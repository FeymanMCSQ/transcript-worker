FROM node:22-slim

# Install system deps: CA certs, curl, ffmpeg, python3, pip, venv
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       ffmpeg \
       python3 \
       python3-pip \
       python3-venv \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp with curl-cffi extras in isolated venv (PEP 668-safe)
RUN python3 -m venv /opt/yt-dlp-venv \
  && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp[default,curl-cffi]" \
  && ln -s /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp

# Install Deno >=2.0 for yt-dlp JS challenge solving
RUN curl -fsSL https://deno.land/install.sh | sh \
  && ln -s /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV PATH="/opt/yt-dlp-venv/bin:${PATH}"
EXPOSE 8080

CMD ["node", "index.js"]
