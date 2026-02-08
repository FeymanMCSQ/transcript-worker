# transcript-worker

Production-oriented YouTube transcript worker built on `yt-dlp`.

The service fetches subtitles, parses WebVTT to plain text, and returns transcript JSON.

This document explains how this repo was hardened so subtitle extraction keeps working under modern YouTube anti-abuse behavior.

Important: this is a reliability strategy, not a bypass guarantee. YouTube behavior changes over time.

## What This Worker Supports
- YouTube URLs only.
- English subtitle preference list: `en,en-US,en-GB`.
- Manual and auto subtitles: `--write-subs --write-auto-subs`.
- Plain text output (timestamps and cue metadata removed).
- Multi-attempt extraction strategy with explicit error classification.

## API
### `GET /api/transcript?url=...`
Fetch a transcript for one YouTube video.

Query parameter:
- `url` required. Example: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`

Success response (`200`):
```json
{
  "errorCode": null,
  "transcript": "plain text transcript here",
  "length": 1234
}
```

Error responses:
- `400` `MISSING_URL` missing or empty `url`.
- `400` `INVALID_URL` URL is not recognized as YouTube.
- `404` `NO_CAPTIONS` no English subtitles found.
- `404` `NO_VTT_FILE` no `.vtt` file was produced.
- `429` `YOUTUBE_RATE_LIMIT` upstream throttle.
- `503` `YOUTUBE_CHALLENGE` challenge/anti-bot block detected.
- `500` `WORKER_SETUP_FAILED` temp workspace prep failed.
- `500` `YTDLP_FAILED` yt-dlp failed after all attempts.
- `500` `FS_ERROR` subtitle file read/parsing filesystem error.
- `502` `EMPTY_TRANSCRIPT` VTT existed but stripped text was empty.

Example:
```bash
curl "http://localhost:3000/api/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## How We Made yt-dlp Reliable Here
The current approach combines runtime parity, request-shape tuning, and clean retries.

1. Runtime parity:
- `yt-dlp` installed with `curl-cffi` extras.
- Deno installed and available for JS challenge solving.
- Node 22 base image.

2. Browser-like network profile:
- `--impersonate chrome`.
- `--js-runtimes deno`.

3. Subtitle-only extraction intent:
- `--skip-download`.
- `--write-subs --write-auto-subs`.
- explicit subtitle format: `--sub-format vtt`.

4. Reduced request noise:
- explicit language list (`en,en-US,en-GB`) instead of broad wildcard patterns.

5. Cookie robustness:
- env cookie blob is normalized before writing file.
- supports escaped newlines/tabs from deployment env UIs.
- auto-adds Netscape cookie header when missing.

6. Controlled retries:
- fast attempt with `android` client.
- cookie-authenticated `web` attempt when cookies are present.
- final anonymous `web` attempt.

7. Strict success rule:
- no partial-success acceptance.
- attempt must exit cleanly and produce a readable `.vtt`.

## End-to-End Request Flow
1. Validate and normalize input URL to canonical `watch?v=...`.
2. Create temp working directory in `/tmp`.
3. Normalize `YT_COOKIES` and write `cookies.txt` if present.
4. Execute yt-dlp attempts in order:
- `fast-android` uses `--extractor-args youtube:player_client=android`
- `with-cookies` uses `--cookies <file> --extractor-args youtube:player_client=web`
- `without-cookies` uses `--extractor-args youtube:player_client=web`
5. For each successful attempt, find matching `.vtt`, parse it to plain text, return transcript.
6. If all attempts fail, classify and return the most actionable error code.

## Exact Command Profile
Base args used in every attempt:
```bash
--impersonate chrome
--js-runtimes deno
--ignore-no-formats-error
--no-playlist
--skip-download
--write-subs
--write-auto-subs
--sub-lang en,en-US,en-GB
--sub-format vtt
```

Attempt-specific shape:
```bash
# fast-android
yt-dlp --extractor-args youtube:player_client=android <base-args> -o "/tmp/<session>/fast-android-%(id)s.%(ext)s" "<url>"

# with-cookies (only if YT_COOKIES is present)
yt-dlp --cookies "/tmp/<session>/cookies.txt" --extractor-args youtube:player_client=web <base-args> -o "/tmp/<session>/with-cookies-%(id)s.%(ext)s" "<url>"

# without-cookies fallback
yt-dlp --extractor-args youtube:player_client=web <base-args> -o "/tmp/<session>/without-cookies-%(id)s.%(ext)s" "<url>"
```

## Cookie Normalization Behavior
The worker normalizes `YT_COOKIES` before writing `cookies.txt`:
- trims outer single/double quotes.
- converts `\r\n` and `\r` to `\n`.
- converts escaped `\\n` and `\\t`.
- reconstructs cookie rows into tab-delimited Netscape format when possible.
- ensures `# Netscape HTTP Cookie File` header exists.
- appends trailing newline for consistent parser behavior.

Why this matters:
- deployment dashboards often mangle multiline secrets.
- malformed cookie rows silently degrade extraction quality.

## Docker and Runtime Requirements
`Dockerfile` currently installs:
- `node:22-slim`
- `python3`, `python3-pip`, `python3-venv`
- `ffmpeg`, `curl`, `unzip`
- `yt-dlp[default,curl-cffi]` inside `/opt/yt-dlp-venv`
- Deno installed and linked into `/usr/local/bin/deno`

Notes:
- venv install is required to avoid PEP 668 `externally-managed-environment` errors on Debian.
- `unzip` is required by Deno installer script.

## Operations Checklist
1. Build and deploy image without stale cache when changing yt-dlp runtime.
2. Confirm logs show `Solving JS challenges using deno`.
3. Confirm no `Ignoring unsupported JavaScript runtime(s)` warnings.
4. Test with one known-caption video.
5. Test with your target video.
6. Validate returned `errorCode` on failures and tune by observed mode.

## Fast Triage Guide
If logs show `n challenge solving failed`:
- confirm Deno is installed and on PATH in container.
- confirm yt-dlp build includes curl-cffi extras.

If logs show `There are no subtitles for the requested languages`:
- verify subtitle language list and video subtitle availability for account/session context.

If logs show `Rate limited by YouTube (429)`:
- reduce request frequency.
- avoid repeated immediate retries on same video.
- test from a different egress/IP profile if infrastructure permits.

If logs show cookie warnings:
- refresh cookies from active browser session.
- verify env formatting for multiline secret storage.

## Security Notes
- Treat `YT_COOKIES` as credential material.
- Never print raw cookie content to logs.
- Temp cookie file is request-scoped and removed during cleanup.
- Rotate cookies immediately if leaked.

## Configuration
- `PORT` default `3000`.
- `YT_COOKIES` optional raw Netscape cookie content.

## Limitations
- YouTube only.
- English-focused subtitle extraction.
- Transcript only, no timestamps in output.
- Subject to YouTube challenge/rate-limit behavior.

## File Reference
- Entrypoint: `index.js`
- Runtime image: `Dockerfile`
