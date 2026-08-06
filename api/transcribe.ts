import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type TranscribeRequestBody = {
  audioBase64?: string;
  filename?: string;
  mimeType?: string;
};

export const ACCEPTED_AUDIO_EXTENSIONS = new Set([
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "m4a",
  "wav",
  "webm",
  "ogg",
  "mov",
  "avi",
  "mkv",
]);

// Keep under Vercel's request body limit (~4.5 MB).
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

export function getExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function isAcceptedAudioFile(filename: string): boolean {
  return ACCEPTED_AUDIO_EXTENSIONS.has(getExtension(filename));
}

export function formatTranscriptLines(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .flatMap((paragraph) =>
      paragraph
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
    )
    .join("\n");
}

export function buildFormatPrompt(rawTranscript: string): string {
  return `Format this verbatim audio transcript for a court reporter.

Rules:
- Do NOT change, add, or remove any words.
- Put each sentence on its own line.
- When the speaker clearly changes, start a new line.
- Add speaker labels (Q., A., THE WITNESS:, etc.) only if clearly identifiable from context.
- Return ONLY the formatted transcript text. No commentary or markdown.

TRANSCRIPT:
${rawTranscript}`;
}

export function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function formatTranscriptWithLLM(openai: OpenAI, rawTranscript: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: buildFormatPrompt(rawTranscript) }],
  });

  const formatted = completion.choices[0]?.message?.content?.trim();
  return formatted || formatTranscriptLines(rawTranscript);
}

export async function handleTranscribeRequest(
  req: Pick<VercelRequest, "method" | "body">,
  res: VercelResponse
): Promise<VercelResponse> {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
  }

  const body = (req.body || {}) as TranscribeRequestBody;
  const filename = typeof body.filename === "string" ? body.filename.trim() : "audio.mp3";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";

  if (!audioBase64) {
    return res.status(400).json({ error: "audioBase64 is required" });
  }

  if (!isAcceptedAudioFile(filename)) {
    return res.status(400).json({ error: "Unsupported audio file type" });
  }

  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(audioBase64, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid audio data" });
  }

  if (!audioBuffer.length) {
    return res.status(400).json({ error: "Audio file is empty" });
  }

  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    return res.status(400).json({
      error: `Audio file exceeds ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB limit for this build`,
    });
  }

  try {
    const openai = getOpenAIClient();
    const uploadFile = await toFile(audioBuffer, filename, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: uploadFile,
      model: "whisper-1",
      response_format: "text",
    });

    const rawTranscript = typeof transcription === "string" ? transcription.trim() : String(transcription).trim();
    if (!rawTranscript) {
      return res.status(500).json({ error: "No speech detected in this file" });
    }

    const formattedTranscript = await formatTranscriptWithLLM(openai, rawTranscript);
    const baseName = filename.replace(/\.[^.]+$/, "") || "audio";

    return res.status(200).json({
      transcript: formattedTranscript,
      downloadName: `${baseName}_transcript.txt`,
      rawLength: rawTranscript.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("transcribe error:", message);
    return res.status(500).json({ error: "Transcription failed" });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleTranscribeRequest(req, res);
}

export const config = {
  maxDuration: 120,
};
