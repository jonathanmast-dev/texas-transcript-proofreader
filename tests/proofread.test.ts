import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProofreadPrompt,
  normalizeCorrection,
  normalizeProofreadResponse,
  normalizeStyle,
  normalizeTranscriptText,
} from "../api/proofread.ts";

test("normalizeStyle accepts known styles and falls back safely", () => {
  assert.equal(normalizeStyle("Texas UFM - Official Reporter"), "Texas UFM - Official Reporter");
  assert.equal(normalizeStyle("Do Not Reword Mode"), "Do Not Reword Mode");
  assert.equal(normalizeStyle("Unknown Style"), "General Proofreading");
});

test("normalizeTranscriptText trims and normalizes line endings", () => {
  assert.equal(normalizeTranscriptText("  hello\r\nworld  "), "hello\nworld");
  assert.equal(normalizeTranscriptText(undefined), "");
});

test("buildProofreadPrompt includes style and transcript text", () => {
  const prompt = buildProofreadPrompt({
    transcriptText: "Q do you understand your right's",
    style: "General Proofreading",
    filename: "depo.txt",
    pages: 3,
  });

  assert.match(prompt, /General Proofreading/);
  assert.match(prompt, /depo\.txt/);
  assert.match(prompt, /do you understand your right's/);
  assert.match(prompt, /RETURN FORMAT/);
});

test("normalizeCorrection drops invalid items and keeps valid ones", () => {
  const correction = normalizeCorrection(
    {
      page: 4,
      line: 12,
      original: "do you understand your right's",
      suggested: "Do you understand your rights?",
      issues: ["capitalization", "punctuation"],
      safe: true,
    },
    0
  );

  assert.ok(correction);
  assert.equal(correction?.page, 4);
  assert.equal(correction?.line, 12);
  assert.equal(correction?.safe, true);

  assert.equal(
    normalizeCorrection({ original: "same", suggested: "same", issues: [] }, 0),
    null
  );
});

test("normalizeProofreadResponse maps summary and corrections", () => {
  const result = normalizeProofreadResponse({
    summary: "Found several punctuation issues.",
    corrections: [
      {
        page: 1,
        line: 2,
        original: "hello",
        suggested: "Hello.",
        issues: ["capitalization"],
        safe: true,
      },
    ],
  });

  assert.equal(result.summary, "Found several punctuation issues.");
  assert.equal(result.corrections.length, 1);
  assert.equal(result.corrections[0]?.suggested, "Hello.");
});
