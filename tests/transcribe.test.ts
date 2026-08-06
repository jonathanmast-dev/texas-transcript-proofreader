import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  buildFormatPrompt,
  formatTranscriptLines,
  getExtension,
  isAcceptedAudioFile,
  MAX_AUDIO_BYTES,
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

test("MAX_AUDIO_BYTES stays under vercel payload limit", () => {
  assert.ok(MAX_AUDIO_BYTES <= 4.5 * 1024 * 1024);
  assert.ok(ACCEPTED_AUDIO_EXTENSIONS.has("mp3"));
});
