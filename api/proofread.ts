import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export type ProofreadRequestBody = {
  transcriptText?: string;
  style?: string;
  filename?: string;
  pages?: number;
};

export type ProofreadCorrection = {
  page: number;
  line: number;
  original: string;
  suggested: string;
  issues: string[];
  safe: boolean;
};

export type ProofreadResponse = {
  corrections: ProofreadCorrection[];
  summary?: string;
};

const ALLOWED_STYLES = new Set([
  "Texas UFM - Official Reporter",
  "Texas UFM - Deputy Reporter",
  "Texas UFM - Freelance Reporter",
  "General Proofreading",
]);

const MAX_TRANSCRIPT_CHARS = 60000;

export function normalizeStyle(value: unknown): string {
  if (typeof value !== "string") {
    return "General Proofreading";
  }
  const trimmed = value.trim();
  return ALLOWED_STYLES.has(trimmed) ? trimmed : "General Proofreading";
}

export function normalizeTranscriptText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\r\n/g, "\n").trim();
}

export function buildStyleRules(style: string): string {
  switch (style) {
    case "Texas UFM - Official Reporter":
      return `Apply Texas Uniform Format Manual (UFM) rules for official court reporters:
- Correct Q/A formatting, speaker labels, capitalization, punctuation, and spelling.
- Preserve page/line references when inferring page and line numbers.
- Follow Texas court reporting conventions for titles, exhibits, and certification language.`;
    case "Texas UFM - Deputy Reporter":
      return `Apply Texas UFM rules tuned for deputy reporter transcripts:
- Same UFM standards as official reporters, with attention to deputy-specific formatting habits.
- Correct Q/A formatting, speaker labels, punctuation, and capitalization.`;
    case "Texas UFM - Freelance Reporter":
      return `Apply Texas UFM rules for freelance/deposition work:
- Correct deposition Q/A formatting, speaker labels, and Texas-specific style.
- Flag formatting inconsistencies common in freelance transcripts.`;
    default:
      return `Apply general proofreading standards:
- Correct capitalization, punctuation, spelling, apostrophes, and obvious typos.
- Flag Q/A formatting and speaker label issues when present.
- Prefer minimal, conservative edits.`;
  }
}

export function buildProofreadPrompt(input: {
  transcriptText: string;
  style: string;
  filename?: string;
  pages?: number;
}): string {
  const { transcriptText, style, filename, pages } = input;
  const styleRules = buildStyleRules(style);

  return `
You are an expert Texas court transcript proofreader and scopist.

TASK:
Review the transcript below and return suggested corrections as JSON.

FORMATTING STYLE:
${style}

STYLE RULES:
${styleRules}

SOURCE:
- Filename: ${filename || "unknown"}
- Estimated pages: ${pages ?? "unknown"}

GLOBAL RULES:
- Do NOT reword content. Transcripts must stay precise — fix only mechanical errors (capitalization, punctuation, spelling, apostrophes, formatting). Never change meaning or word choice.
- Identify real issues present in the transcript text.
- Each correction must reference a plausible page and line number based on the transcript layout.
- "original" must be an exact substring from the transcript (copy verbatim).
- "suggested" is the corrected replacement for that substring or line.
- "issues" is an array of short issue tags (e.g. capitalization, punctuation, spelling, apostrophe, Q/A formatting, speaker label, date consistency, citation format).
- "safe" is true for low-risk mechanical fixes (punctuation, capitalization, spelling, apostrophe). false for substantive rewording, names, dates, or legal citations.
- Return between 3 and 20 corrections depending on how many issues exist. If the transcript is clean, return fewer items.
- Do NOT invent content that is not supported by the transcript.
- Return ONLY valid JSON. No markdown, no commentary.

RETURN FORMAT:
{
  "summary": "One sentence describing the overall review.",
  "corrections": [
    {
      "page": 4,
      "line": 12,
      "original": "exact text from transcript",
      "suggested": "corrected text",
      "issues": ["capitalization", "punctuation"],
      "safe": true
    }
  ]
}

TRANSCRIPT:
${transcriptText}
`;
}

export function normalizeCorrection(raw: unknown, index: number): ProofreadCorrection | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const item = raw as Record<string, unknown>;
  const original = typeof item.original === "string" ? item.original.trim() : "";
  const suggested = typeof item.suggested === "string" ? item.suggested.trim() : "";
  if (!original || !suggested || original === suggested) {
    return null;
  }

  const page = Number(item.page);
  const line = Number(item.line);
  const issues = Array.isArray(item.issues)
    ? item.issues.filter((issue): issue is string => typeof issue === "string" && issue.trim()).slice(0, 8)
    : [];

  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    line: Number.isFinite(line) && line > 0 ? Math.floor(line) : index + 1,
    original,
    suggested,
    issues: issues.length ? issues : ["proofreading"],
    safe: item.safe === true,
  };
}

export function normalizeProofreadResponse(parsed: unknown): ProofreadResponse {
  const payload = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const rawCorrections = Array.isArray(payload.corrections) ? payload.corrections : [];
  const corrections = rawCorrections
    .map((item, index) => normalizeCorrection(item, index))
    .filter((item): item is ProofreadCorrection => item !== null);

  const summary = typeof payload.summary === "string" ? payload.summary.trim() : undefined;
  return { corrections, summary };
}

export function setCorsHeaders(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export async function handleProofreadRequest(
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

  const body = (req.body || {}) as ProofreadRequestBody;
  const transcriptText = normalizeTranscriptText(body.transcriptText);
  const style = normalizeStyle(body.style);

  if (!transcriptText) {
    return res.status(400).json({ error: "transcriptText is required" });
  }

  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(400).json({
      error: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} character limit for this build`,
    });
  }

  const prompt = buildProofreadPrompt({
    transcriptText,
    style,
    filename: typeof body.filename === "string" ? body.filename : undefined,
    pages: typeof body.pages === "number" ? body.pages : undefined,
  });

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content ?? "";
    console.log("OpenAI proofread raw response:", content);

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return res.status(500).json({ error: "Failed to parse proofread response" });
    }

    const normalized = normalizeProofreadResponse(parsed);
    return res.status(200).json(normalized);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("proofread error:", message);
    return res.status(500).json({ error: "Proofread failed" });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return handleProofreadRequest(req, res);
}
