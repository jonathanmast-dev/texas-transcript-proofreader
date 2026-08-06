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

1. Upload audio/video (mp3, mp4, m4a, wav, webm, etc. — max 4 MB)
2. Run transcription via `/api/transcribe`
3. OpenAI Whisper transcribes verbatim, then formats one sentence/speaker per line
4. Download `.txt`

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
3. Add env var: `OPENAI_API_KEY`
4. Deploy — static files, `/api/proofread`, and `/api/transcribe` deploy together.

## Tests

```bash
npm test
```
