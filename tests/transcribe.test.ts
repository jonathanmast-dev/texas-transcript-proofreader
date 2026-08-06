import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFormatPrompt,
  formatTranscriptLines,
  getExtension,
  isAcceptedAudioFile,
  LEGACY_BASE64_MAX_BYTES,
  LLM_FORMAT_MAX_CHARS,
  MAX_AUDIO_BYTES,
  shouldUseLlmFormatting,
} from "../api/transcribe.ts";

test("isAcceptedAudioFile accepts common audio and video containers", () => {
  assert.equal(isAcceptedAudioFile("depo.mp3"), true);
  assert.equal(isAcceptedAudioFile("hearing.MP4"), true);
  assert.equal(isAcceptedAudioFile("notes.txt"), false);
});

test("getExtension returns lowercase extension", () => {
  assert.equal(getExtension("audio.WAV"), "wav");
});

test("formatTranscriptLines splits sentences onto separate lines", () => {
  const formatted = formatTranscriptLines("Hello there. How are you? I am fine.");
  assert.equal(formatted, "Hello there.\nHow are you?\nI am fine.");
});

test("buildFormatPrompt includes verbatim formatting rules", () => {
  const prompt = buildFormatPrompt("Q. What is your name?");
  assert.match(prompt, /Do NOT change, add, or remove any words/);
  assert.match(prompt, /Q\. What is your name\?/);
});

test("MAX_AUDIO_BYTES matches OpenAI limit", () => {
  assert.equal(MAX_AUDIO_BYTES, 25 * 1024 * 1024);
  assert.ok(LEGACY_BASE64_MAX_BYTES < MAX_AUDIO_BYTES);
});

test("shouldUseLlmFormatting skips long transcripts", () => {
  const short = "a".repeat(LLM_FORMAT_MAX_CHARS);
  const long = "a".repeat(LLM_FORMAT_MAX_CHARS + 1);
  assert.equal(shouldUseLlmFormatting(short), true);
  assert.equal(shouldUseLlmFormatting(long), false);
});
