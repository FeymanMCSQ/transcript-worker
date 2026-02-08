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
import { execFile } from 'child_process';
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

function cleanYoutubeUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let videoId = null;

    if (host.includes('youtube.com')) {
      videoId = u.searchParams.get('v');
    } else if (host === 'youtu.be') {
      videoId = u.pathname.slice(1);
    }

    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch {
    // ignore
  }
  return url;
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

function classifyYtDlpText(text) {
  const msg = (text || '').toLowerCase();
  return {
    isRateLimited: msg.includes('http error 429'),
    isChallengeBlocked:
      msg.includes('n challenge solving failed') ||
      msg.includes('only images are available for download') ||
      msg.includes('requested format is not available') ||
      msg.includes('sign in to confirm') ||
      msg.includes('confirm you are not a bot'),
    isNoCaptions:
      msg.includes('unable to download video subtitles') ||
      msg.includes('no subtitles') ||
      msg.includes('no caption') ||
      msg.includes('no captions') ||
      msg.includes('there are no subtitles for the requested languages'),
  };
}

function runYtDlp(args) {
  return new Promise((resolve) => {
    execFile(
      'yt-dlp',
      args,
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          err: err || null,
          stdoutText: (stdout || '').toString(),
          stderrText: (stderr || '').toString(),
        });
      }
    );
  });
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

  const cleanUrl = cleanYoutubeUrl(url);
  console.log('[worker] Original URL:', url);
  console.log('[worker] Cleaned URL:', cleanUrl);

  let dir = null;

  try {
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

    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-'));

    const cookiePath = path.join(dir, 'cookies.txt');
    const cookieData = process.env.YT_COOKIES || '';

    if (cookieData) {
      await fs.writeFile(cookiePath, cookieData, 'utf8');
      console.log('[worker] Cookies file created.');
    }

    const baseArgs = [
      '--js-runtimes',
      'node',
      '--ignore-no-formats-error',
      '--no-playlist',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang',
      'en.*',
      '--sub-format',
      'vtt',
    ];

    const attempts = [];
    if (cookieData) {
      attempts.push({
        label: 'with-cookies',
        args: [
          '--cookies',
          cookiePath,
          '--extractor-args',
          'youtube:player_client=web',
          ...baseArgs,
          '-o',
          path.join(dir, 'with-cookies-%(id)s.%(ext)s'),
          cleanUrl,
        ],
      });
    }

    attempts.push({
      label: 'without-cookies',
      args: [
        '--extractor-args',
        'youtube:player_client=android,web',
        ...baseArgs,
        '-o',
        path.join(dir, 'without-cookies-%(id)s.%(ext)s'),
        cleanUrl,
      ],
    });

    let sawRateLimit = false;
    let sawChallenge = false;
    let sawNoCaptions = false;
    let sawAnyYtDlpError = false;
    let sawEmptyTranscript = false;

    for (const attempt of attempts) {
      console.log(
        `[worker] Running command (${attempt.label}):`,
        `yt-dlp ${attempt.args.join(' ')}`
      );

      const { err, stdoutText, stderrText } = await runYtDlp(attempt.args);
      const combinedText = `${stderrText}\n${stdoutText}\n${
        err?.message || ''
      }`;
      const outcome = classifyYtDlpText(combinedText);

      if (stderrText) {
        console.warn(
          `[worker] yt-dlp stderr (${attempt.label}) preview:`,
          stderrText.slice(0, 400)
        );
      }
      if (stdoutText) {
        console.log(
          `[worker] yt-dlp stdout (${attempt.label}) preview:`,
          stdoutText.slice(0, 400)
        );
      }

      sawRateLimit = sawRateLimit || outcome.isRateLimited;
      sawChallenge = sawChallenge || outcome.isChallengeBlocked;
      sawNoCaptions = sawNoCaptions || outcome.isNoCaptions;
      sawAnyYtDlpError = sawAnyYtDlpError || Boolean(err);

      if (err) {
        console.warn(
          `[worker] yt-dlp attempt failed (${attempt.label}) with exit code:`,
          typeof err.code !== 'undefined' ? err.code : null
        );
        continue;
      }

      try {
        const files = await fs.readdir(dir);
        const vttFile = files.find(
          (f) => f.startsWith(`${attempt.label}-`) && f.endsWith('.vtt')
        );

        if (!vttFile) {
          console.warn(
            `[worker] No .vtt file produced in attempt (${attempt.label}).`
          );
          continue;
        }

        const fullPath = path.join(dir, vttFile);
        const vtt = await fs.readFile(fullPath, 'utf8');
        const text = stripVttToPlainText(vtt);

        if (!text.trim()) {
          console.warn(
            `[worker] Caption file was empty after stripping (${attempt.label}).`
          );
          sawEmptyTranscript = true;
          continue;
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
    }

    if (sawRateLimit) {
      console.error('[worker] Rate limited by YouTube (429).');
      return finish(429, {
        errorCode: 'YOUTUBE_RATE_LIMIT',
        message:
          'YouTube is rate-limiting this server (HTTP 429). Try again later or paste the transcript manually.',
      });
    }

    if (sawChallenge) {
      console.error(
        '[worker] YouTube anti-bot challenge blocked subtitle extraction.'
      );
      return finish(503, {
        errorCode: 'YOUTUBE_CHALLENGE',
        message:
          'YouTube challenge checks blocked caption extraction for this request. Retry later, rotate IP, refresh cookies, or update yt-dlp/challenge components.',
      });
    }

    if (sawNoCaptions) {
      console.error('[worker] No subtitles available for this video.');
      return finish(404, {
        errorCode: 'NO_CAPTIONS',
        message:
          'No English captions were found for this video (manual or auto).',
      });
    }

    if (sawEmptyTranscript) {
      console.error('[worker] Captions were present but empty after stripping.');
      return finish(502, {
        errorCode: 'EMPTY_TRANSCRIPT',
        message:
          'Captions were fetched but the resulting transcript was empty after processing.',
      });
    }

    if (sawAnyYtDlpError) {
      return finish(500, {
        errorCode: 'YTDLP_FAILED',
        message: 'yt-dlp failed to fetch captions after all retries.',
      });
    }

    console.error('[worker] No .vtt file produced by yt-dlp in any attempt.');
    return finish(404, {
      errorCode: 'NO_VTT_FILE',
      message: 'No caption (.vtt) file was produced for this video.',
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
