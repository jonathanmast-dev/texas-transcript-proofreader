import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  getExtension,
  MAX_AUDIO_BYTES,
  setCorsHeaders,
} from "./transcribe";

const ALLOWED_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-m4a",
  "audio/m4a",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/octet-stream",
];

function buildWebRequest(req: VercelRequest): Request {
  const host = req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "http";
  const url = `${proto}://${host}${req.url || "/api/upload-audio"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }

  return new Request(url, {
    method: req.method || "POST",
    headers,
    body: JSON.stringify(req.body ?? {}),
  });
}

export async function handleUploadAudioRequest(
  req: VercelRequest,
  res: VercelResponse
): Promise<VercelResponse> {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: "BLOB_READ_WRITE_TOKEN is not configured" });
  }

  try {
    const body = req.body as HandleUploadBody;
    const result = await handleUpload({
      request: buildWebRequest(req),
      body,
      onBeforeGenerateToken: async (pathname) => {
        const ext = getExtension(pathname);
        if (!ACCEPTED_AUDIO_EXTENSIONS.has(ext)) {
          throw new Error("Unsupported audio file type");
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_AUDIO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return res.status(200).json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("upload-audio error:", message);
    return res.status(400).json({ error: message });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleUploadAudioRequest(req, res);
}
