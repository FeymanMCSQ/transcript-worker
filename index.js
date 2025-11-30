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

app.get('/api/transcript', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-dlp-'));

  const outputPattern = path.join(dir, '%(id)s.%(ext)s');
  const cmd = `yt-dlp --skip-download --write-auto-subs --sub-lang en --sub-format vtt -o "${outputPattern}" "${url}"`;

  exec(cmd, async (err) => {
    if (err) {
      console.error('yt-dlp failed:', err);
      return res.status(500).json({ error: 'yt-dlp failed to fetch captions' });
    }

    const files = await fs.readdir(dir);
    const vttFile = files.find((f) => f.endsWith('.vtt'));

    if (!vttFile) {
      return res.status(404).json({ error: 'No caption file found' });
    }

    const fullPath = path.join(dir, vttFile);
    const vtt = await fs.readFile(fullPath, 'utf8');
    const text = stripVttToPlainText(vtt);

    await fs.rm(dir, { recursive: true, force: true });

    return res.json({
      transcript: text,
      length: text.length,
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Transcript worker running on ${PORT}`));
