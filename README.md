# Texas Transcript Proofreader

Web app for proofreading Texas court transcripts. Frontend + API in one repo.
The OpenAI key lives only in server env (Vercel or local `.env`) — never in the browser.

## Workflow

1. Upload `.docx`, `.pdf`, `.txt`, or `.ascii`
2. Choose a transcript style
3. Run proofread
4. Review, accept, reject, or edit corrections
5. Export final transcript as PDF

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
4. Deploy — static files and `/api/proofread` deploy together.

## Tests

```bash
npm test
```
