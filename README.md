# Texas Transcript Tools

Web app for Texas court transcript proofreading and audio transcription.
Frontend + API in one repo. The OpenAI key lives only in server env — never in the browser.

## Proofreader tab

1. Upload `.docx`, `.pdf`, `.txt`, or `.ascii`
2. Choose a transcript style
3. Run proofread via `/api/proofread`
4. Review, accept, reject, or edit corrections
5. Export final transcript

## Audio Transcriber tab

1. Upload audio/video (mp3, mp4, m4a, wav, webm, etc. — max 25 MB)
2. File uploads to **Vercel Blob** first (bypasses API size limit), then `/api/transcribe`
3. OpenAI Whisper transcribes verbatim, then formats one sentence/speaker per line
4. Download `.txt`

### Vercel Blob setup (required for files over ~4 MB)

1. Vercel dashboard → **Storage** → **Create Blob store**
2. Connect the store to this project (sets `BLOB_READ_WRITE_TOKEN` automatically)
3. Redeploy

For local dev, copy `BLOB_READ_WRITE_TOKEN` into `.env` or run `vercel env pull`.

## Local development

```bash
npm install
# Add OPENAI_API_KEY to .env (see .env.example)
npm run dev
```

Open http://localhost:8000

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import in Vercel.
3. Add env vars: `OPENAI_API_KEY`, and connect a **Blob store** (auto-sets `BLOB_READ_WRITE_TOKEN`)
4. Deploy — static files, `/api/proofread`, `/api/transcribe`, and `/api/upload-audio` deploy together.

## Tests

```bash
npm test
```
