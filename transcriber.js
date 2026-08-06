const ACCEPTED_AUDIO_EXTENSIONS = [
  "mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm", "ogg", "mov", "avi", "mkv",
];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const state = {
  file: null,
  transcript: "",
  downloadName: "",
  isRunning: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  audioInput: $("audio-input"),
  audioDropzone: $("audio-dropzone"),
  audioSummary: $("audio-summary"),
  audioName: $("audio-name"),
  audioSub: $("audio-sub"),
  clearAudio: $("clear-audio"),
  transcribeBtn: $("transcribe-btn"),
  transcribeHint: $("transcribe-hint"),
  transcribeEmpty: $("transcribe-empty"),
  transcribeResult: $("transcribe-result"),
  transcriptPreview: $("transcript-preview"),
  downloadTranscriptBtn: $("download-transcript-btn"),
  toast: $("toast"),
};

function getTranscribeUrl() {
  return (window.APP_CONFIG && window.APP_CONFIG.TRANSCRIBE_URL) || "/api/transcribe";
}

function getExtension(name) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  requestAnimationFrame(() => els.toast.classList.add("show"));
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => els.toast.classList.add("hidden"), 200);
  }, 2600);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read this audio file"));
    reader.readAsDataURL(file);
  });
}

function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateTranscribeState() {
  const ready = Boolean(state.file) && !state.isRunning;
  els.transcribeBtn.disabled = !ready;
  els.transcribeHint.textContent = !state.file
    ? "Upload an audio file to enable transcription."
    : state.isRunning
      ? "Transcribing audio…"
      : "Ready. Click to transcribe with OpenAI.";
}

function resetResults() {
  state.transcript = "";
  state.downloadName = "";
  els.transcribeEmpty.classList.remove("hidden");
  els.transcribeResult.classList.add("hidden");
  els.transcriptPreview.textContent = "";
  els.downloadTranscriptBtn.disabled = true;
}

function handleAudioFile(file) {
  if (!file) return;

  const ext = getExtension(file.name);
  if (!ACCEPTED_AUDIO_EXTENSIONS.includes(ext)) {
    showToast("Unsupported audio type. Use mp3, mp4, wav, m4a, etc.");
    return;
  }

  if (file.size > MAX_AUDIO_BYTES) {
    showToast("File too large. Max 4 MB for this build.");
    return;
  }

  state.file = file;
  resetResults();
  els.audioName.textContent = file.name;
  els.audioSub.textContent = `${ext.toUpperCase()} · ${formatBytes(file.size)}`;
  els.audioSummary.classList.remove("hidden");
  els.audioDropzone.classList.add("hidden");
  updateTranscribeState();
}

function clearAudio() {
  state.file = null;
  resetResults();
  els.audioInput.value = "";
  els.audioSummary.classList.add("hidden");
  els.audioDropzone.classList.remove("hidden");
  updateTranscribeState();
}

function renderTranscriptResult() {
  els.transcribeEmpty.classList.add("hidden");
  els.transcribeResult.classList.remove("hidden");
  els.transcriptPreview.textContent = state.transcript;
  els.downloadTranscriptBtn.disabled = !state.transcript;
}

async function runTranscription() {
  if (!state.file || state.isRunning) return;

  state.isRunning = true;
  els.transcribeBtn.classList.add("is-loading");
  els.transcribeBtn.querySelector(".btn-label").textContent = "Transcribing…";
  updateTranscribeState();

  try {
    const audioBase64 = await readFileAsBase64(state.file);
    const response = await fetch(getTranscribeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        filename: state.file.name,
        mimeType: state.file.type || "application/octet-stream",
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Transcription request failed");
    }

    state.transcript = typeof payload.transcript === "string" ? payload.transcript : "";
    state.downloadName =
      typeof payload.downloadName === "string" ? payload.downloadName : "transcript.txt";

    if (!state.transcript) {
      throw new Error("No transcript returned");
    }

    renderTranscriptResult();
    els.transcribeResult.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Transcription complete");
  } catch (err) {
    console.error(err);
    showToast(err instanceof Error ? err.message : "Transcription failed");
  } finally {
    state.isRunning = false;
    els.transcribeBtn.classList.remove("is-loading");
    els.transcribeBtn.querySelector(".btn-label").textContent = "Run Transcription";
    updateTranscribeState();
  }
}

function downloadTranscript() {
  if (!state.transcript) return;
  downloadTextFile(state.transcript, state.downloadName || "transcript.txt");
  showToast("Transcript downloaded");
}

function initTranscriber() {
  if (!els.audioDropzone) return;

  updateTranscribeState();

  els.audioInput.addEventListener("change", (e) => handleAudioFile(e.target.files[0]));
  els.clearAudio.addEventListener("click", clearAudio);
  els.transcribeBtn.addEventListener("click", runTranscription);
  els.downloadTranscriptBtn.addEventListener("click", downloadTranscript);

  els.audioDropzone.addEventListener("click", () => els.audioInput.click());
  els.audioDropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.audioInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) =>
    els.audioDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.audioDropzone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.audioDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      els.audioDropzone.classList.remove("dragover");
    })
  );
  els.audioDropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    handleAudioFile(file);
  });
}

document.addEventListener("DOMContentLoaded", initTranscriber);
