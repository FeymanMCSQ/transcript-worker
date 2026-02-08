# transcript-worker

A small HTTP service that fetches YouTube captions with `yt-dlp`, strips the WebVTT formatting, and returns plain text.

**What it supports today**
- YouTube URLs only. Non-YouTube URLs are rejected.
- English captions (`--sub-lang en.*`).
- Manual and auto-generated captions (`--write-subs --write-auto-subs`).
- Returns plain text (timestamps and cue indices are removed).

**Important**
Some videos trigger YouTube anti-bot challenge checks. The worker retries with two extraction strategies (with cookies, then without cookies) and returns `YOUTUBE_CHALLENGE` when extraction is still blocked upstream.

## Requirements
- Node.js (project uses ES modules)
- `yt-dlp` available on your PATH
- Optional: `YT_COOKIES` environment variable if you need authenticated access to private or age-gated videos

## Run locally
1. Install dependencies with `npm install`.
2. Start the server with `npm start`.
3. The server listens on `http://localhost:3000` unless `PORT` is set.

## API
### `GET /api/transcript?url=...`
Fetches the transcript for a single YouTube video.

**Query parameters**
- `url` (required): YouTube URL (e.g. `https://www.youtube.com/watch?v=VIDEO_ID` or `https://youtu.be/VIDEO_ID`).

**Success response** (`200`)
```json
{
  "errorCode": null,
  "transcript": "plain text transcript here",
  "length": 1234
}
```

**Error responses**
- `400` `MISSING_URL`: `url` query parameter missing or empty
- `400` `INVALID_URL`: URL is not recognized as a YouTube URL
- `404` `NO_CAPTIONS`: No English captions found (manual or auto)
- `404` `NO_VTT_FILE`: `yt-dlp` succeeded but no `.vtt` file was produced
- `429` `YOUTUBE_RATE_LIMIT`: YouTube returned HTTP 429
- `503` `YOUTUBE_CHALLENGE`: YouTube challenge checks blocked caption extraction
- `500` `WORKER_SETUP_FAILED`: Failed to create temp workspace
- `500` `YTDLP_FAILED`: `yt-dlp` exited with an error
- `500` `FS_ERROR`: Failed reading the generated caption file
- `502` `EMPTY_TRANSCRIPT`: Captions existed but stripped transcript was empty

**Example request**
```bash
curl "http://localhost:3000/api/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## How it works
1. Validates the URL and normalizes it to `https://www.youtube.com/watch?v=VIDEO_ID`.
2. Creates a temporary directory.
3. Writes a `cookies.txt` file if `YT_COOKIES` is provided.
4. Executes yt-dlp attempts in order:
   - with cookies (if `YT_COOKIES` is provided): `--extractor-args youtube:player_client=web ...`
   - fallback without cookies: `--extractor-args youtube:player_client=android,web ...`
   Both attempts use: `--ignore-no-formats-error --no-playlist --skip-download --write-subs --write-auto-subs --sub-lang en.* --sub-format vtt`
5. Reads the `.vtt` output, strips timestamps and cue indices, and returns plain text.

## Configuration
- `PORT`: Port to bind the HTTP server (default `3000`).
- `YT_COOKIES`: Raw cookies text to pass to `yt-dlp` for authenticated requests. The worker writes it to a temporary `cookies.txt` file.

## Limitations
- English only.
- YouTube only.
- No timestamps in the output, just plain text.
- Subject to YouTube rate limiting (HTTP 429).

## Notes on changing caption behavior
If you want to support manual captions and/or additional languages, update the `yt-dlp` command in `index.js`.
Common options:
- `--write-subs` to request manual captions
- `--write-auto-subs` to request auto captions
- `--sub-lang en,es` to request multiple languages
- `--sub-format vtt` to keep WebVTT

## File reference
- Server entrypoint: `index.js`
