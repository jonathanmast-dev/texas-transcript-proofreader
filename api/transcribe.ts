import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { del } from "@vercel/blob";
import { toFile } from "openai/uploads";

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type TranscribeRequestBody = {
  blobUrl?: string;
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

// OpenAI Whisper limit.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Legacy direct-upload fallback for local dev (Vercel request body limit).
export const LEGACY_BASE64_MAX_BYTES = 4 * 1024 * 1024;

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

export async function loadAudioBuffer(body: TranscribeRequestBody): Promise<{
  buffer: Buffer;
  filename: string;
  mimeType: string;
  blobUrl?: string;
}> {
  const filename = typeof body.filename === "string" ? body.filename.trim() : "audio.mp3";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "application/octet-stream";
  const blobUrl = typeof body.blobUrl === "string" ? body.blobUrl.trim() : "";
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64.trim() : "";

  if (!isAcceptedAudioFile(filename)) {
    throw new Error("Unsupported audio file type");
  }

  if (blobUrl) {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch uploaded audio");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Audio file is empty");
    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new Error(`Audio file exceeds ${Math.round(MAX_AUDIO_BYTES / (1024 * 1024))} MB limit`);
    }
    return { buffer, filename, mimeType, blobUrl };
  }

  if (audioBase64) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(audioBase64, "base64");
    } catch {
      throw new Error("Invalid audio data");
    }
    if (!buffer.length) throw new Error("Audio file is empty");
    if (buffer.length > LEGACY_BASE64_MAX_BYTES) {
      throw new Error(
        `Files over ${Math.round(LEGACY_BASE64_MAX_BYTES / (1024 * 1024))} MB must use blob upload`
      );
    }
    return { buffer, filename, mimeType };
  }

  throw new Error("blobUrl or audioBase64 is required");
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
  let blobUrl: string | undefined;

  try {
    const audio = await loadAudioBuffer(body);
    blobUrl = audio.blobUrl;

    const openai = getOpenAIClient();
    const uploadFile = await toFile(audio.buffer, audio.filename, { type: audio.mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: uploadFile,
      model: "whisper-1",
      response_format: "text",
    });

    const rawTranscript =
      typeof transcription === "string" ? transcription.trim() : String(transcription).trim();
    if (!rawTranscript) {
      return res.status(500).json({ error: "No speech detected in this file" });
    }

    const formattedTranscript = await formatTranscriptWithLLM(openai, rawTranscript);
    const baseName = audio.filename.replace(/\.[^.]+$/, "") || "audio";

    if (blobUrl) {
      try {
        await del(blobUrl);
      } catch (cleanupErr) {
        console.warn("blob cleanup failed:", cleanupErr);
      }
    }

    return res.status(200).json({
      transcript: formattedTranscript,
      downloadName: `${baseName}_transcript.txt`,
      rawLength: rawTranscript.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("transcribe error:", message);
    return res.status(message.includes("required") || message.includes("Unsupported") ? 400 : 500).json({
      error: message.includes("Failed") || message.includes("exceeds") || message.includes("required")
        ? message
        : "Transcription failed",
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleTranscribeRequest(req, res);
}

export const config = {
  maxDuration: 120,
};
