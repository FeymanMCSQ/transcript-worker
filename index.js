// import express from 'express';
// import cors from 'cors';
// import { exec } from 'child_process';
// import fs from 'fs/promises';
// import path from 'path';
// import os from 'os';

// const app = express();
// app.use(cors());
// app.use(express.json());

// function stripVttToPlainText(vtt) {
//   const lines = vtt.split(/\r?\n/);
//   const out = [];

//   const timestampRegex =
//     /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

//   for (const line of lines) {
//     const trimmed = line.trim();
//     if (!trimmed) continue;
//     if (trimmed === 'WEBVTT') continue;
//     if (/^\d+$/.test(trimmed)) continue;
//     if (timestampRegex.test(trimmed)) continue;

//     out.push(trimmed);
//   }

//   return out.join(' ');
// }

// app.get('/api/transcript', async (req, res) => {
//   const url = req.query.url;
//   if (!url) return res.status(400).json({ error: 'Missing url' });

//   const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-'));

//   const outputPattern = path.join(dir, '%(id)s.%(ext)s');
//   const cmd = `yt-dlp --skip-download --write-auto-subs --sub-lang en --sub-format vtt -o "${outputPattern}" "${url}"`;

//   exec(cmd, async (err) => {
//     if (err) {
//       console.error('yt-dlp failed:', err);
//       return res.status(500).json({ error: 'yt-dlp failed to fetch captions' });
//     }

//     const files = await fs.readdir(dir);
//     const vttFile = files.find((f) => f.endsWith('.vtt'));

//     if (!vttFile) {
//       return res.status(404).json({ error: 'No caption file found' });
//     }

//     const fullPath = path.join(dir, vttFile);
//     const vtt = await fs.readFile(fullPath, 'utf8');
//     const text = stripVttToPlainText(vtt);

//     await fs.rm(dir, { recursive: true, force: true });

//     return res.json({
//       transcript: text,
//       length: text.length,
//     });
//   });
// });

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`Transcript worker running on ${PORT}`));

// index.js

import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const app = express();
app.use(cors());
app.use(express.json());

function stripVttToPlainText(vtt) {
  const lines = vtt.split(/\r?\n/);
  const out = [];

  const timestampRegex =
    /^\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'WEBVTT') continue;
    if (/^\d+$/.test(trimmed)) continue;
    if (timestampRegex.test(trimmed)) continue;

    out.push(trimmed);
  }

  return out.join(' ');
}

function isLikelyYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      host.includes('youtube.com') ||
      host === 'youtu.be' ||
      host.endsWith('.youtube.com')
    );
  } catch {
    return false;
  }
}

app.get('/api/transcript', async (req, res) => {
  const rawUrl = req.query.url;

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return res.status(400).json({
      errorCode: 'MISSING_URL',
      message: 'Query parameter "url" is required.',
    });
  }

  const url = rawUrl.trim();

  if (!isLikelyYoutubeUrl(url)) {
    return res.status(400).json({
      errorCode: 'INVALID_URL',
      message: 'The provided URL does not look like a valid YouTube URL.',
    });
  }

  let dir = null;

  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-'));

    const outputPattern = path.join(dir, '%(id)s.%(ext)s');
    const cmd = `yt-dlp --skip-download --write-auto-subs --sub-lang en --sub-format vtt -o "${outputPattern}" "${url}"`;

    console.log('[worker] Running command:', cmd);

    exec(cmd, async (err, stdout, stderr) => {
      // helper: always try to clean up temp dir, then send response
      const finish = async (statusCode, payload) => {
        if (dir) {
          try {
            await fs.rm(dir, { recursive: true, force: true });
          } catch (cleanupErr) {
            console.error('[worker] Failed to clean temp dir:', cleanupErr);
          }
        }
        return res.status(statusCode).json(payload);
      };

      const stderrText = (stderr || '').toString();
      const stdoutText = (stdout || '').toString();

      if (stderrText) {
        console.warn(
          '[worker] yt-dlp stderr (preview):',
          stderrText.slice(0, 400)
        );
      }
      if (stdoutText) {
        console.log(
          '[worker] yt-dlp stdout (preview):',
          stdoutText.slice(0, 400)
        );
      }

      if (err) {
        const msg = (stderrText || err.message || '').toLowerCase();

        if (msg.includes('http error 429')) {
          console.error('[worker] Rate limited by YouTube (429).');
          return finish(429, {
            errorCode: 'YOUTUBE_RATE_LIMIT',
            message:
              'YouTube is rate-limiting this server (HTTP 429). Try again later or paste the transcript manually.',
          });
        }

        if (
          msg.includes('unable to download video subtitles') ||
          msg.includes('no subtitles') ||
          msg.includes('no caption') ||
          msg.includes('no captions')
        ) {
          console.error('[worker] No subtitles available for this video.');
          return finish(404, {
            errorCode: 'NO_CAPTIONS',
            message:
              'No English captions were found for this video (manual or auto).',
          });
        }

        console.error('[worker] yt-dlp failed:', err);
        return finish(500, {
          errorCode: 'YTDLP_FAILED',
          message: 'yt-dlp failed to fetch captions.',
          details: {
            exitCode: err && typeof err.code !== 'undefined' ? err.code : null,
          },
        });
      }

      // Success path: yt-dlp exited cleanly, try to find and parse the vtt
      try {
        const files = await fs.readdir(dir);
        const vttFile = files.find((f) => f.endsWith('.vtt'));

        if (!vttFile) {
          console.error('[worker] No .vtt file produced by yt-dlp.');
          return finish(404, {
            errorCode: 'NO_VTT_FILE',
            message: 'No caption (.vtt) file was produced for this video.',
          });
        }

        const fullPath = path.join(dir, vttFile);
        const vtt = await fs.readFile(fullPath, 'utf8');
        const text = stripVttToPlainText(vtt);

        if (!text.trim()) {
          console.error('[worker] Caption file was empty after stripping.');
          return finish(502, {
            errorCode: 'EMPTY_TRANSCRIPT',
            message:
              'Captions were fetched but the resulting transcript was empty after processing.',
          });
        }

        console.log(
          '[worker] Transcript length:',
          text.length,
          'preview:',
          text.slice(0, 200),
          '...'
        );

        return finish(200, {
          errorCode: null,
          transcript: text,
          length: text.length,
        });
      } catch (fsErr) {
        console.error(
          '[worker] Filesystem error while reading captions:',
          fsErr
        );
        return finish(500, {
          errorCode: 'FS_ERROR',
          message:
            'Captions were fetched, but there was a filesystem error while reading the transcript.',
        });
      }
    });
  } catch (outerErr) {
    console.error('[worker] Fatal error before running yt-dlp:', outerErr);
    if (dir) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(
          '[worker] Failed to clean temp dir after fatal error:',
          cleanupErr
        );
      }
    }
    return res.status(500).json({
      errorCode: 'WORKER_SETUP_FAILED',
      message: 'Failed to prepare temporary environment for yt-dlp.',
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Transcript worker running on ${PORT}`));
