const els = {
  planStatus: document.querySelector("#planStatus"),
  appVersion: document.querySelector("#appVersion"),
  updateNotice: document.querySelector("#updateNotice"),
  refreshAppBtn: document.querySelector("#refreshAppBtn"),
  fileInput: document.querySelector("#fileInput"),
  fileStatus: document.querySelector("#fileStatus"),
  loadIndicator: document.querySelector("#loadIndicator"),
  loadPhase: document.querySelector("#loadPhase"),
  loadProgressFill: document.querySelector("#loadProgressFill"),
  loadProgressText: document.querySelector("#loadProgressText"),
  loadDemo: document.querySelector("#loadDemo"),
  saveDocumentBtn: document.querySelector("#saveDocumentBtn"),
  savedDocsStatus: document.querySelector("#savedDocsStatus"),
  savedDocumentsList: document.querySelector("#savedDocumentsList"),
  styleSelect: document.querySelector("#styleSelect"),
  langSelect: document.querySelector("#langSelect"),
  aiVoiceSelect: document.querySelector("#aiVoiceSelect"),
  aiStyleSelect: document.querySelector("#aiStyleSelect"),
  testVoiceBtn: document.querySelector("#testVoiceBtn"),
  rateRange: document.querySelector("#rateRange"),
  pitchRange: document.querySelector("#pitchRange"),
  rateValue: document.querySelector("#rateValue"),
  pitchValue: document.querySelector("#pitchValue"),
  filterToggle: document.querySelector("#filterToggle"),
  playBtn: document.querySelector("#playBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  backBtn: document.querySelector("#backBtn"),
  nextHeadingBtn: document.querySelector("#nextHeadingBtn"),
  playbackStatus: document.querySelector("#playbackStatus"),
  playerProgressFill: document.querySelector("#playerProgressFill"),
  playerProgressText: document.querySelector("#playerProgressText"),
  insightTabSummary: document.querySelector("#insightTabSummary"),
  insightTabQuestion: document.querySelector("#insightTabQuestion"),
  summaryPane: document.querySelector("#summaryPane"),
  questionPane: document.querySelector("#questionPane"),
  summarizeBtn: document.querySelector("#summarizeBtn"),
  summaryOutput: document.querySelector("#summaryOutput"),
  questionInput: document.querySelector("#questionInput"),
  askBtn: document.querySelector("#askBtn"),
  answerOutput: document.querySelector("#answerOutput"),
  modeButtons: Array.from(document.querySelectorAll(".mode-btn")),
};

const PLAN_KEY = "leesmee_plan_v1";
const SAVED_DOCS_KEY = "leesmee_saved_docs_v1";
const APP_VERSION = "v2026-05-10.3";
const AI_RETRY_ATTEMPTS = 3;
const AI_RETRY_DELAY_MS = 900;
const PLAN_LIMITS = {
  free: 5,
  premium: 50,
  zakelijk: 250,
};
const AI_TTS_ENDPOINT = "/api/tts";
const MAX_DOCUMENT_CHARS = 350000;
const MAX_PDF_PAGES = 220;
const CHUNK_MAX_CHARS = 900;
const PLAYBACK_STATES = {
  IDLE: "idle",
  LOADING: "loading",
  PLAYING: "playing",
  PAUSED: "paused",
  STOPPING: "stopping",
};

const STYLE_PRESETS = {
  calm: { rate: 1.0, pitch: 0.95 },
  business: { rate: 1.0, pitch: 1.0 },
  warm: { rate: 0.95, pitch: 1.1 },
  energy: { rate: 1.15, pitch: 1.12 },
  clear: { rate: 0.8, pitch: 0.9 },
};

const STOPWORDS = new Set([
  "de",
  "het",
  "een",
  "en",
  "van",
  "op",
  "in",
  "voor",
  "met",
  "te",
  "dat",
  "dit",
  "die",
  "als",
  "aan",
  "bij",
  "is",
  "zijn",
  "wordt",
  "werd",
  "naar",
  "om",
  "of",
  "dan",
  "maar",
  "ook",
  "you",
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "are",
]);

const state = {
  sourceName: "",
  rawText: "",
  cleanedText: "",
  chunks: [],
  chapters: [],
  activeMode: "full",
  activeChunks: [],
  selectedChapter: 0,
  currentIndex: 0,
  currentChunkId: "",
  speaking: false,
  paused: false,
  stopRequested: false,
  aiAudio: null,
  aiResolve: null,
  playbackSessionId: 0,
  playbackState: PLAYBACK_STATES.IDLE,
  pendingServiceWorker: null,
  plan: loadPlan(),
  savedDocuments: loadSavedDocuments(),
  summaryCache: null,
  documentWasTrimmed: false,
  originalDocumentLength: 0,
};

let pdfModulePromise = null;

init();

function init() {
  bindEvents();
  applyUrlIntents();
  renderAppVersion();
  updatePlanBadge();
  renderSavedDocuments();
  applyStylePreset(els.styleSelect.value);
  refreshRanges();
  setInsightTab("summary");
  setPlaybackStatus("Gestopt");
  setLoadProgress("Wacht op bestand", 0);
  updatePlaybackProgress();
  syncPlaybackButtons();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      registerServiceWorker();
    });
  }
}

function bindEvents() {
  els.fileInput.addEventListener("change", onFileChange);
  els.loadDemo.addEventListener("click", () => {
    setLoadProgress("Inlezen", 55);
    void loadDocument(DEMO_TEXT, "Voorbeeldtekst");
  });
  els.refreshAppBtn?.addEventListener("click", refreshToLatestVersion);
  els.saveDocumentBtn.addEventListener("click", saveCurrentDocument);
  els.savedDocumentsList.addEventListener("click", onSavedDocumentsClick);

  els.styleSelect.addEventListener("change", (event) => {
    applyStylePreset(event.target.value);
    refreshRanges();
  });

  els.testVoiceBtn.addEventListener("click", () => {
    testVoice();
  });

  els.rateRange.addEventListener("input", refreshRanges);
  els.pitchRange.addEventListener("input", refreshRanges);
  els.filterToggle.addEventListener("change", () => {
    if (!state.rawText) {
      return;
    }
    setStatus("Filter wordt toegepast...");
    void processDocument().then(() => {
      setLoadProgress("Klaar", 100);
      setStatus(`Filter toegepast (${state.chunks.length} luisterblokken).`);
    });
  });

  els.playBtn.addEventListener("click", startPlayback);
  els.pauseBtn.addEventListener("click", togglePause);
  els.stopBtn.addEventListener("click", stopPlayback);
  els.backBtn.addEventListener("click", jumpBack);
  els.nextHeadingBtn.addEventListener("click", jumpToNextHeading);

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.mode || "full");
    });
  });

  els.insightTabSummary.addEventListener("click", () => {
    setInsightTab("summary");
  });

  els.insightTabQuestion.addEventListener("click", () => {
    setInsightTab("question");
  });

  els.summarizeBtn.addEventListener("click", () => {
    const summary = ensureSummary();
    if (!summary) {
      return;
    }
    els.summaryOutput.textContent = summary.summaryText;
    setStatus("Samenvatting bijgewerkt.");
  });

  els.askBtn.addEventListener("click", () => {
    const question = els.questionInput.value.trim();
    if (!question) {
      els.answerOutput.textContent = "Typ eerst een vraag.";
      return;
    }
    els.answerOutput.textContent = answerQuestion(question);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.speaking) {
      togglePause();
    }
  });
}

function setInsightTab(tab) {
  const summaryActive = tab === "summary";
  els.summaryPane.classList.toggle("active", summaryActive);
  els.questionPane.classList.toggle("active", !summaryActive);
  els.insightTabSummary.classList.toggle("active", summaryActive);
  els.insightTabQuestion.classList.toggle("active", !summaryActive);
  els.insightTabSummary.setAttribute("aria-pressed", String(summaryActive));
  els.insightTabQuestion.setAttribute("aria-pressed", String(!summaryActive));
}

function applyUrlIntents() {
  const url = new URL(window.location.href);
  let touched = false;

  const plan = (url.searchParams.get("plan") || "").toLowerCase();
  if (isValidPlan(plan)) {
    setPlan(plan);
    touched = true;
  }

  const language = url.searchParams.get("lang");
  if (
    language &&
    (language === "nl-NL" || language === "en-US" || language === "de-DE" || language === "hu-HU")
  ) {
    els.langSelect.value = language;
    touched = true;
  }

  if (touched) {
    history.replaceState({}, "", url.pathname);
  }
}

function setPlan(plan) {
  state.plan = plan;
  persistPlan();
  updatePlanBadge();
  renderSavedDocuments();
}

function updatePlanBadge() {
  const label = state.plan === "premium" ? "Premium" : state.plan === "zakelijk" ? "Zakelijk" : "Free";
  els.planStatus.textContent = `Plan: ${label}`;
}

function persistPlan() {
  localStorage.setItem(PLAN_KEY, state.plan);
}

function loadPlan() {
  const raw = (localStorage.getItem(PLAN_KEY) || "free").toLowerCase();
  return isValidPlan(raw) ? raw : "free";
}

function loadSavedDocuments() {
  try {
    const raw = localStorage.getItem(SAVED_DOCS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.id === "string" &&
          typeof entry.name === "string" &&
          typeof entry.text === "string"
      )
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        text: entry.text,
        updatedAt: Number(entry.updatedAt) || Date.now(),
      }))
      .slice(0, PLAN_LIMITS.zakelijk);
  } catch {
    return [];
  }
}

function persistSavedDocuments() {
  localStorage.setItem(SAVED_DOCS_KEY, JSON.stringify(state.savedDocuments));
}

function planLimit() {
  return PLAN_LIMITS[state.plan] || PLAN_LIMITS.free;
}

function renderSavedDocuments() {
  const limit = planLimit();
  els.savedDocsStatus.textContent = `${state.savedDocuments.length} / ${limit} opgeslagen documenten`;
  els.savedDocumentsList.innerHTML = "";

  if (!state.savedDocuments.length) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "Nog geen opgeslagen documenten.";
    els.savedDocumentsList.appendChild(empty);
    return;
  }

  state.savedDocuments.forEach((doc) => {
    const row = document.createElement("li");
    row.className = "saved-item";

    const label = document.createElement("span");
    label.className = "saved-item-name";
    label.textContent = doc.name;

    const actions = document.createElement("div");
    actions.className = "saved-item-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "secondary small-btn";
    openBtn.dataset.action = "open";
    openBtn.dataset.docId = doc.id;
    openBtn.textContent = "Open";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost small-btn";
    deleteBtn.dataset.action = "delete";
    deleteBtn.dataset.docId = doc.id;
    deleteBtn.textContent = "Verwijder";

    actions.append(openBtn, deleteBtn);
    row.append(label, actions);
    els.savedDocumentsList.appendChild(row);
  });
}

function onSavedDocumentsClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const button = target.closest("button[data-action][data-doc-id]");
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  const docId = button.dataset.docId || "";
  const action = button.dataset.action || "";
  if (!docId) {
    return;
  }

  if (action === "open") {
    openSavedDocument(docId);
    return;
  }

  if (action === "delete") {
    deleteSavedDocument(docId);
  }
}

function openSavedDocument(docId) {
  const doc = state.savedDocuments.find((entry) => entry.id === docId);
  if (!doc) {
    return;
  }
  void loadDocument(doc.text, doc.name);
}

function deleteSavedDocument(docId) {
  state.savedDocuments = state.savedDocuments.filter((entry) => entry.id !== docId);
  persistSavedDocuments();
  renderSavedDocuments();
  setStatus("Document verwijderd uit opslag.");
}

function saveCurrentDocument() {
  if (!state.rawText) {
    setStatus("Laad eerst een document voordat je opslaat.");
    return;
  }

  const name = state.sourceName || `Document ${state.savedDocuments.length + 1}`;
  const normalizedText = normalizeText(state.rawText);
  const existingIndex = state.savedDocuments.findIndex(
    (entry) => entry.name === name && entry.text === normalizedText
  );

  if (existingIndex >= 0) {
    const existing = state.savedDocuments.splice(existingIndex, 1)[0];
    existing.updatedAt = Date.now();
    state.savedDocuments.unshift(existing);
    persistSavedDocuments();
    renderSavedDocuments();
    setStatus(`${name} was al opgeslagen en staat nu bovenaan.`);
    return;
  }

  const limit = planLimit();
  if (state.savedDocuments.length >= limit) {
    setStatus(`Je ${state.plan} plan kan maximaal ${limit} documenten opslaan.`);
    return;
  }

  state.savedDocuments.unshift({
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    text: normalizedText,
    updatedAt: Date.now(),
  });
  persistSavedDocuments();
  renderSavedDocuments();
  setStatus(`${name} opgeslagen.`);
}

function isValidPlan(value) {
  return value === "free" || value === "premium" || value === "zakelijk";
}

async function onFileChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
    return;
  }

  const file = input.files[0];
  setLoadProgress("Inlezen", 5);
  setStatus(`${file.name} wordt ingelezen...`);
  const text = await extractTextFromFile(file);
  if (!text) {
    setLoadProgress("Mislukt", 0);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      setStatus(
        "Deze PDF bevat waarschijnlijk geen selecteerbare tekst (scan/afbeelding). Probeer OCR of exporteer eerst naar tekst."
      );
      return;
    }
    if (lower.endsWith(".doc") || lower.endsWith(".epub")) {
      setStatus(
        "Dit bestandstype wordt nog niet direct uitgelezen in de browser. Gebruik DOCX of PDF met tekstlaag."
      );
      return;
    }
    setStatus(
      "Kon dit bestand niet direct uitlezen. Probeer een tekstlaag (OCR) of converteer het bestand naar DOCX."
    );
    return;
  }

  setLoadProgress("Inlezen", 55);
  await waitForUi();
  await loadDocument(text, file.name);
}

async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  const kind = await detectFileKind(file, name, type);

  if (kind === "text") {
    setLoadProgress("Inlezen", 28);
    return file.text();
  }

  if (kind === "docx") {
    return extractDocxText(file);
  }

  if (kind === "pdf") {
    return extractPdfText(file);
  }

  // EPUB/legacy DOC vraagt extra parserlogica; daarvoor tonen we nu een fallback.
  return null;
}

async function detectFileKind(file, name, type) {
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".html") ||
    type.startsWith("text/")
  ) {
    return "text";
  }

  if (
    name.endsWith(".pdf") ||
    type === "application/pdf" ||
    type.includes("pdf")
  ) {
    return "pdf";
  }

  if (
    name.endsWith(".docx") ||
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }

  // Fallback op bestandssignatuur (handig op mobiel waar extensie soms ontbreekt)
  try {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const isPdf =
      header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
    if (isPdf) {
      return "pdf";
    }

    const isZip = header[0] === 0x50 && header[1] === 0x4b;
    if (isZip && (name.endsWith(".docx") || type.includes("wordprocessingml"))) {
      return "docx";
    }
  } catch {
    // Geen hard fail; dan blijft unknown over.
  }

  return "unknown";
}

async function extractDocxText(file) {
  if (!window.mammoth || typeof window.mammoth.extractRawText !== "function") {
    return null;
  }

  try {
    setLoadProgress("Inlezen", 20);
    const arrayBuffer = await file.arrayBuffer();
    setLoadProgress("Inlezen", 42);
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    setLoadProgress("Inlezen", 55);
    return result.value || null;
  } catch {
    return null;
  }
}

async function extractPdfText(file) {
  try {
    setLoadProgress("Inlezen", 12);
    if (!pdfModulePromise) {
      pdfModulePromise = import(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.mjs"
      );
    }
    const pdfjs = await pdfModulePromise;
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.mjs";

    const buffer = await file.arrayBuffer();
    const doc = await pdfjs
      .getDocument({
        data: buffer,
        disableWorker: true,
        useWorkerFetch: false,
      })
      .promise;
    const pages = [];
    const pagesToRead = Math.min(doc.numPages, MAX_PDF_PAGES);

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const percent = 12 + Math.round((pageNumber / pagesToRead) * 43);
      setLoadProgress("Inlezen", percent);
      if (pageNumber === 1 || pageNumber % 10 === 0 || pageNumber === pagesToRead) {
        setStatus(`PDF wordt gelezen (${pageNumber}/${pagesToRead} pagina's)...`);
        await waitForUi();
      }
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent({ normalizeWhitespace: true });
      const pageText = content.items
        .map((item) => (item.str || "").trim())
        .filter(Boolean)
        .join(" ");
      pages.push(pageText);
    }

    const combined = pages.join("\n\n").trim();
    return combined.length >= 20 ? combined : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "onbekende fout";
    setStatus(`PDF parserfout: ${message}`);
    return null;
  }
}

async function loadDocument(text, sourceName) {
  stopPlayback();
  state.sourceName = sourceName;
  const normalizedText = normalizeText(text);
  const clamped = clampDocumentText(normalizedText);
  state.rawText = clamped.text;
  state.documentWasTrimmed = clamped.trimmed;
  state.originalDocumentLength = clamped.originalLength;
  setStatus(`${sourceName} wordt verwerkt...`);
  setLoadProgress("Opdelen", 60);
  await waitForUi();
  await processDocument();
  setLoadProgress("Klaar", 100);
  if (state.documentWasTrimmed) {
    setStatus(
      `${sourceName} geladen (${state.chunks.length} luisterblokken). Document is voor stabiliteit ingekort van ${state.originalDocumentLength.toLocaleString(
        "nl-NL"
      )} naar ${MAX_DOCUMENT_CHARS.toLocaleString("nl-NL")} tekens.`
    );
    return;
  }
  setStatus(`${sourceName} geladen (${state.chunks.length} luisterblokken).`);
}

async function processDocument() {
  setLoadProgress("Opdelen", 62);
  await waitForUi();
  const cleaned = cleanDocumentText(state.rawText, els.filterToggle.checked);
  setLoadProgress("Opdelen", 70);
  await waitForUi();
  state.cleanedText = cleaned.text;
  state.chapters = cleaned.chapters;
  state.chunks = await buildChunks(cleaned.text, cleaned.chapters, (fraction) => {
    const percentage = 70 + Math.round(Math.min(Math.max(fraction, 0), 1) * 28);
    setLoadProgress("Opdelen", percentage);
  });
  state.summaryCache = null;
  state.currentIndex = 0;
  state.currentChunkId = state.chunks[0]?.id || "";
  setMode(state.activeMode, true);
}

function normalizeText(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/ {2,}/g, " ").trim();
}

function clampDocumentText(text) {
  const originalLength = text.length;
  if (originalLength <= MAX_DOCUMENT_CHARS) {
    return {
      text,
      trimmed: false,
      originalLength,
    };
  }

  return {
    text: text.slice(0, MAX_DOCUMENT_CHARS).trim(),
    trimmed: true,
    originalLength,
  };
}

function cleanDocumentText(text, applySmartFilter) {
  const lines = text.split("\n");
  const frequencies = new Map();

  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.length >= 3 && normalized.length <= 70) {
      frequencies.set(normalized, (frequencies.get(normalized) || 0) + 1);
    }
  }

  const cleanedLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const normalized = trimmed.toLowerCase();

    if (!trimmed) {
      cleanedLines.push("");
      continue;
    }

    if (applySmartFilter) {
      if (/^pagina\s+\d+(\s+van\s+\d+)?$/i.test(trimmed)) {
        continue;
      }
      if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(trimmed)) {
        continue;
      }
      if (/^\d+\s*\/\s*\d+$/.test(trimmed)) {
        continue;
      }
      if ((frequencies.get(normalized) || 0) > 3 && normalized.length < 45) {
        continue;
      }
    }

    cleanedLines.push(trimmed);
  }

  const cleanText = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: cleanText,
    chapters: detectChapters(cleanText),
  };
}

function detectChapters(text) {
  const lines = text.split("\n");
  const chapters = [];
  let position = 0;

  for (const line of lines) {
    const candidate = line.trim();
    if (looksLikeHeading(candidate)) {
      const title = candidate.replace(/[:\-]+$/, "");
      if (!chapters.some((chapter) => chapter.title.toLowerCase() === title.toLowerCase())) {
        chapters.push({ title, at: position });
      }
    }
    position += line.length + 1;
  }

  if (!chapters.length) {
    chapters.push({ title: "Start", at: 0 });
  }

  return chapters.slice(0, 20);
}

function looksLikeHeading(line) {
  if (!line) {
    return false;
  }
  if (line.length < 3 || line.length > 90) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 12) {
    return false;
  }

  if (/^(hoofdstuk|chapter|sectie|onderwerp)\b/i.test(line)) {
    return true;
  }

  if (/^\d+(\.\d+)*[\).:-]?\s+/.test(line)) {
    return true;
  }

  if (line === line.toUpperCase() && /[A-Z]/.test(line)) {
    return true;
  }

  return !/[.!?]$/.test(line) && words.length <= 8;
}

async function buildChunks(text, chapters, onProgress) {
  const chunks = [];
  let currentText = "";
  let chunkStart = 0;
  let cursor = 0;

  const flush = () => {
    if (!currentText.trim()) {
      return;
    }
    const id = `c${chunks.length + 1}`;
    const chapterIndex = findChapterIndex(chunkStart, chapters);
    chunks.push({
      id,
      text: currentText.trim(),
      start: chunkStart,
      end: cursor,
      chapterIndex,
    });
    currentText = "";
  };

  const lines = text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const baseCursor = cursor;
    const trimmed = line.trim();
    cursor += line.length + 1;

    if (!trimmed) {
      continue;
    }

    const sentenceParts = (trimmed.match(/[^.!?]+[.!?]?/g) || [trimmed])
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const sentences = sentenceParts.flatMap((part) => splitSentenceByMaxLength(part, CHUNK_MAX_CHARS));

    for (const sentence of sentences) {
      if (!currentText) {
        currentText = sentence;
        chunkStart = baseCursor;
        continue;
      }

      if (currentText.length + sentence.length + 1 > CHUNK_MAX_CHARS) {
        flush();
        currentText = sentence;
        chunkStart = baseCursor;
      } else {
        currentText += ` ${sentence}`;
      }
    }

    if (typeof onProgress === "function") {
      const ratio = lines.length ? (lineIndex + 1) / lines.length : 1;
      onProgress(ratio);
    }

    if (lineIndex % 120 === 0) {
      await waitForUi();
    }
  }

  flush();
  if (typeof onProgress === "function") {
    onProgress(1);
  }
  return chunks;
}

function splitSentenceByMaxLength(sentence, maxLength) {
  if (sentence.length <= maxLength) {
    return [sentence];
  }

  const words = sentence.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return sentence.match(new RegExp(`.{1,${maxLength}}`, "g")) || [sentence];
  }

  const parts = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (current.length + word.length + 1 > maxLength) {
      parts.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.flatMap((part) =>
    part.length <= maxLength ? [part] : part.match(new RegExp(`.{1,${maxLength}}`, "g")) || [part]
  );
}

function findChapterIndex(position, chapters) {
  let index = 0;
  for (let i = 0; i < chapters.length; i += 1) {
    if (chapters[i].at <= position) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

function setMode(mode, keepIndex = false) {
  state.activeMode = mode;
  els.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });

  rebuildActiveChunks();

  if (!keepIndex) {
    state.currentIndex = 0;
    state.currentChunkId = state.activeChunks[0]?.id || "";
  }

  if (!state.activeChunks.length) {
    setStatus("In deze focusmodus zijn nog geen stukken gevonden.");
  }

  highlightCurrentChunk();
  updatePlaybackProgress();
  syncPlaybackButtons();
}

function rebuildActiveChunks() {
  const all = state.chunks;
  if (!all.length) {
    state.activeChunks = [];
    return;
  }

  if (state.activeMode === "full") {
    state.activeChunks = all;
    return;
  }

  if (state.activeMode === "summary") {
    const summary = ensureSummary();
    state.activeChunks = summary?.summaryChunks || [];
    return;
  }

  if (state.activeMode === "chapters") {
    const index = Number.isInteger(state.selectedChapter) ? state.selectedChapter : 0;
    const scoped = all.filter((chunk) => chunk.chapterIndex === index);
    state.activeChunks = scoped;
    return;
  }

  if (state.activeMode === "conclusions") {
    const pattern =
      /(conclusie|conclusies|actie|actiepunt|deadline|risico|besluit|afspraak|volgende stap|planning)/i;
    state.activeChunks = all.filter((chunk) => pattern.test(chunk.text));
    return;
  }

  state.activeChunks = all;
}

function refreshRanges() {
  els.rateValue.textContent = `${Number(els.rateRange.value).toFixed(1)}x`;
  els.pitchValue.textContent = Number(els.pitchRange.value).toFixed(1);
}

function applyStylePreset(name) {
  const preset = STYLE_PRESETS[name];
  if (!preset) {
    return;
  }
  els.rateRange.value = String(preset.rate);
  els.pitchRange.value = String(preset.pitch);
}

async function testVoice() {
  if (state.playbackState !== PLAYBACK_STATES.IDLE) {
    setStatus("Stop eerst het voorlezen voordat je de stemtest start.");
    return;
  }
  const ok = await speakWithAi(sampleTestSentence());
  if (!ok) {
    setStatus(
      "AI-stemtest mislukt. Controleer Netlify Function en OPENAI_API_KEY in Netlify."
    );
  }
}

function startPlayback() {
  if (state.playbackState === PLAYBACK_STATES.LOADING || state.playbackState === PLAYBACK_STATES.STOPPING) {
    setStatus("Even geduld, de speler verwerkt nog een actie.");
    syncPlaybackButtons();
    return;
  }

  if (state.playbackState === PLAYBACK_STATES.PLAYING) {
    setStatus("Voorlezen is al bezig.");
    syncPlaybackButtons();
    return;
  }

  if (!state.activeChunks.length) {
    setStatus("Laad eerst een document.");
    setPlaybackStatus("Wacht op document");
    syncPlaybackButtons();
    return;
  }

  if (state.playbackState === PLAYBACK_STATES.PAUSED && state.aiAudio) {
    setPlaybackStatus("Hervatten...");
    syncPlaybackButtons();
    state.aiAudio
      .play()
      .then(() => {
        setPlaybackState(PLAYBACK_STATES.PLAYING);
        setStatus("Voorlezen hervat.");
        setPlaybackStatus("Bezig met afspelen");
        syncPlaybackButtons();
      })
      .catch(() => {
        setPlaybackState(PLAYBACK_STATES.PAUSED);
        setPlaybackStatus("Gepauzeerd");
        syncPlaybackButtons();
        setStatus("Hervatten lukt niet. Tik opnieuw op Start.");
      });
    return;
  }
  setPlaybackState(PLAYBACK_STATES.LOADING);
  setPlaybackStatus("Audio ophalen...");
  syncPlaybackButtons();
  void startAiPlayback();
}

async function startAiPlayback() {
  if (!state.activeChunks.length) {
    setPlaybackState(PLAYBACK_STATES.IDLE);
    syncPlaybackButtons();
    return;
  }

  const safeIndex = Math.min(Math.max(state.currentIndex, 0), state.activeChunks.length - 1);
  state.playbackSessionId += 1;
  const sessionId = state.playbackSessionId;
  state.stopRequested = false;
  state.currentIndex = safeIndex;
  setPlaybackState(PLAYBACK_STATES.LOADING);
  setPlaybackStatus("Audio ophalen...");
  updatePlaybackProgress();
  syncPlaybackButtons();

  let nextBlobPromise = fetchAiAudioBlob(state.activeChunks[safeIndex].text, sessionId);

  for (let index = safeIndex; index < state.activeChunks.length; index += 1) {
    if (state.stopRequested || sessionId !== state.playbackSessionId) {
      syncPlaybackButtons();
      return;
    }

    state.currentIndex = index;
    state.currentChunkId = state.activeChunks[index].id;
    highlightCurrentChunk();
    updatePlaybackProgress();

    const audioBlob = await nextBlobPromise;
    if (state.stopRequested || sessionId !== state.playbackSessionId) {
      syncPlaybackButtons();
      return;
    }
    if (!audioBlob) {
      setPlaybackState(PLAYBACK_STATES.IDLE);
      setPlaybackStatus("Gestopt");
      syncPlaybackButtons();
      return;
    }

    const nextIndex = index + 1;
    nextBlobPromise =
      nextIndex < state.activeChunks.length
        ? fetchAiAudioBlob(state.activeChunks[nextIndex].text, sessionId)
        : null;

    setPlaybackState(PLAYBACK_STATES.PLAYING);
    setPlaybackStatus("Bezig met afspelen");
    const ok = await playAudioBlob(audioBlob, sessionId);
    if (!ok) {
      if (!state.stopRequested && sessionId === state.playbackSessionId) {
        setPlaybackState(PLAYBACK_STATES.IDLE);
        setPlaybackStatus("Gestopt");
      }
      syncPlaybackButtons();
      return;
    }
  }

  setPlaybackState(PLAYBACK_STATES.IDLE);
  setStatus("Klaar met voorlezen.");
  setPlaybackStatus("Klaar");
  updatePlaybackProgress(true);
  syncPlaybackButtons();
}

function togglePause() {
  if (state.playbackState === PLAYBACK_STATES.LOADING) {
    setStatus("Audio wordt nog opgehaald. Gebruik Stop om direct te annuleren.");
    syncPlaybackButtons();
    return;
  }

  if (!state.aiAudio && state.playbackState === PLAYBACK_STATES.PLAYING) {
    state.stopRequested = true;
    setPlaybackState(PLAYBACK_STATES.PAUSED);
    setStatus("Pauze aangevraagd...");
    setPlaybackStatus("Gepauzeerd");
    syncPlaybackButtons();
    return;
  }

  if (state.aiAudio && state.playbackState === PLAYBACK_STATES.PLAYING && !state.aiAudio.paused) {
    state.aiAudio.pause();
    setPlaybackState(PLAYBACK_STATES.PAUSED);
    setStatus("Voorlezen gepauzeerd.");
    setPlaybackStatus("Gepauzeerd");
    syncPlaybackButtons();
    return;
  }

  if (state.aiAudio && state.playbackState === PLAYBACK_STATES.PAUSED) {
    setPlaybackStatus("Hervatten...");
    syncPlaybackButtons();
    state.aiAudio
      .play()
      .then(() => {
        setPlaybackState(PLAYBACK_STATES.PLAYING);
        setStatus("Voorlezen hervat.");
        setPlaybackStatus("Bezig met afspelen");
        syncPlaybackButtons();
      })
      .catch(() => {
        setPlaybackState(PLAYBACK_STATES.PAUSED);
        setPlaybackStatus("Gepauzeerd");
        syncPlaybackButtons();
        setStatus("Hervatten lukt niet. Tik opnieuw op Start.");
      });
    return;
  }

  syncPlaybackButtons();
}

function stopPlayback() {
  if (state.playbackState === PLAYBACK_STATES.STOPPING) {
    return;
  }

  setPlaybackState(PLAYBACK_STATES.STOPPING);
  syncPlaybackButtons();
  state.playbackSessionId += 1;
  if (typeof state.aiResolve === "function") {
    state.aiResolve(false);
  }
  if (state.aiAudio) {
    state.aiAudio.pause();
    state.aiAudio.src = "";
    state.aiAudio = null;
  }
  state.stopRequested = true;
  setPlaybackState(PLAYBACK_STATES.IDLE);
  setPlaybackStatus("Gestopt");
  updatePlaybackProgress();
  syncPlaybackButtons();
}

async function fetchAiAudioBlob(text, sessionId = state.playbackSessionId, attempt = 1) {
  if (state.stopRequested || sessionId !== state.playbackSessionId) {
    return null;
  }

  try {
    if (attempt === 1) {
      setStatus("AI-stem maakt audio...");
    } else {
      setStatus(`AI-stem nieuwe poging ${attempt}/${AI_RETRY_ATTEMPTS}...`);
    }

    const response = await fetch(AI_TTS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: els.aiVoiceSelect.value,
        instructions: aiInstructions(),
        speed: Number(els.rateRange.value),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (shouldRetryVoiceRequest(response.status, attempt)) {
        const retryInMs = AI_RETRY_DELAY_MS * attempt;
        setStatus(
          `AI-stem tijdelijk fout (${response.status}). Opnieuw proberen over ${Math.round(retryInMs / 1000)} sec...`
        );
        await sleep(retryInMs);
        return fetchAiAudioBlob(text, sessionId, attempt + 1);
      }
      setStatus(`AI-stem fout (${response.status}): ${body || "onbekend"}`);
      return null;
    }

    const audioBlob = await response.blob();
    if (!audioBlob.size) {
      setStatus("AI-stem gaf een lege audioresponse.");
      return null;
    }
    return audioBlob;
  } catch {
    if (attempt < AI_RETRY_ATTEMPTS) {
      const retryInMs = AI_RETRY_DELAY_MS * attempt;
      setStatus(
        `AI-stem tijdelijk onbereikbaar. Opnieuw proberen over ${Math.round(retryInMs / 1000)} sec...`
      );
      await sleep(retryInMs);
      return fetchAiAudioBlob(text, sessionId, attempt + 1);
    }
    setStatus("AI-stem niet bereikbaar. Controleer internet en Netlify Function.");
    return null;
  }
}

async function speakWithAi(text, sessionId = state.playbackSessionId) {
  const audioBlob = await fetchAiAudioBlob(text);
  if (!audioBlob) {
    return false;
  }
  return playAudioBlob(audioBlob, sessionId);
}

function playAudioBlob(blob, sessionId) {
  return new Promise((resolve) => {
    if (state.stopRequested || sessionId !== state.playbackSessionId) {
      resolve(false);
      return;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    state.aiAudio = audio;
    let done = false;

    const clean = (result) => {
      if (done) {
        return;
      }
      done = true;
      URL.revokeObjectURL(url);
      if (state.aiAudio === audio) {
        state.aiAudio = null;
      }
      if (state.aiResolve === clean) {
        state.aiResolve = null;
      }
      resolve(result);
    };

    state.aiResolve = clean;
    audio.onended = () => clean(true);
    audio.onerror = () => clean(false);
    audio.play().catch(() => clean(false));
  });
}

function aiInstructions() {
  const style = els.aiStyleSelect.value;
  const lang = els.langSelect.value;
  const languageName = languageLabel(lang);

  if (style === "warm") {
    return `Speak ${languageName} in a warm, friendly tone with a calm cadence.`;
  }
  if (style === "clear") {
    return `Speak ${languageName} very clearly, a bit slower, with precise articulation.`;
  }
  return `Speak ${languageName} naturally, neutral, and clear.`;
}

function languageLabel(langCode) {
  if (langCode === "en-US") {
    return "English";
  }
  if (langCode === "de-DE") {
    return "German";
  }
  if (langCode === "hu-HU") {
    return "Hungarian";
  }
  return "Dutch";
}

function sampleTestSentence() {
  const lang = els.langSelect.value;
  if (lang === "en-US") {
    return "Hello, this is a short AI voice test for LeesMee.";
  }
  if (lang === "de-DE") {
    return "Hallo, dies ist ein kurzer KI-Stimmtest für LeesMee.";
  }
  if (lang === "hu-HU") {
    return "Szia, ez egy rövid MI hangteszt a LeesMee alkalmazáshoz.";
  }
  return "Hallo, dit is een korte AI-stemtest voor LeesMee.";
}

function jumpBack() {
  if (!state.activeChunks.length) {
    syncPlaybackButtons();
    return;
  }

  const shouldContinue = state.speaking || state.paused;
  stopPlayback();
  state.currentIndex = Math.max(0, state.currentIndex - 2);
  state.currentChunkId = state.activeChunks[state.currentIndex]?.id || "";
  highlightCurrentChunk();
  updatePlaybackProgress();

  if (shouldContinue) {
    startPlayback();
    return;
  }
  syncPlaybackButtons();
}

function jumpToNextHeading() {
  if (!state.chunks.length) {
    syncPlaybackButtons();
    return;
  }

  const currentChunk = state.activeChunks[state.currentIndex] || state.chunks[0];
  if (!currentChunk) {
    syncPlaybackButtons();
    return;
  }

  const currentChapter = currentChunk.chapterIndex;
  const nextChapter = state.chapters.findIndex((_, index) => index > currentChapter);

  if (nextChapter === -1) {
    setStatus("Je bent al bij de laatste kop.");
    syncPlaybackButtons();
    return;
  }

  jumpToChapter(nextChapter, state.speaking || state.paused);
}

function jumpToChapter(chapterIndex, startPlaying) {
  const targetChunk = state.chunks.find((chunk) => chunk.chapterIndex === chapterIndex);
  if (!targetChunk) {
    syncPlaybackButtons();
    return;
  }

  state.selectedChapter = chapterIndex;
  if (state.activeMode === "chapters") {
    rebuildActiveChunks();
    state.currentIndex = 0;
    state.currentChunkId = state.activeChunks[0]?.id || targetChunk.id;
  } else {
    jumpToChunkId(targetChunk.id, false);
  }

  highlightCurrentChunk();
  updatePlaybackProgress();

  if (startPlaying) {
    startPlayback();
    return;
  }
  syncPlaybackButtons();
}

function jumpToChunkId(chunkId, resumePlayback) {
  if (!chunkId) {
    syncPlaybackButtons();
    return;
  }

  const inModeIndex = state.activeChunks.findIndex((chunk) => chunk.id === chunkId);

  if (inModeIndex === -1) {
    setMode("full");
  }

  const index = state.activeChunks.findIndex((chunk) => chunk.id === chunkId);
  if (index === -1) {
    syncPlaybackButtons();
    return;
  }

  const shouldContinue = resumePlayback && (state.speaking || state.paused);
  stopPlayback();
  state.currentIndex = index;
  state.currentChunkId = chunkId;
  highlightCurrentChunk();
  updatePlaybackProgress();

  if (shouldContinue) {
    startPlayback();
    return;
  }
  syncPlaybackButtons();
}

function highlightCurrentChunk() {
  // De tekstkolom is verwijderd; we bewaren alleen intern de actieve positie voor voorlezen.
}

function ensureSummary() {
  if (!state.chunks.length) {
    setStatus("Laad eerst een document om samen te vatten.");
    return null;
  }

  if (state.summaryCache) {
    return state.summaryCache;
  }

  const keywords = topKeywords(state.cleanedText, 8);

  const analysisChunks = sampleAnalysisChunks(state.chunks, 4000);

  const scored = analysisChunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk.text, keywords),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .filter((entry) => entry.score > 0)
    .sort((a, b) => a.chunk.start - b.chunk.start)
    .map((entry) => entry.chunk);

  const summaryChunks = scored.length
    ? scored
    : analysisChunks.slice(0, Math.min(4, analysisChunks.length));

  const topChapterNames = state.chapters.slice(0, 3).map((chapter) => chapter.title);
  const primaryPoints = topChapterNames.length
    ? topChapterNames
    : keywords.slice(0, 3).map((keyword) => keyword.word);

  const summaryLines = [
    "Kern in 3 punten:",
    ...primaryPoints.slice(0, 3).map((point) => `- ${capitalize(point)}`),
    "",
    "Belangrijkste tekststukken:",
    ...summaryChunks.map((chunk) => `- ${chunk.text}`),
  ];

  state.summaryCache = {
    summaryChunks,
    summaryText: summaryLines.join("\n"),
  };

  return state.summaryCache;
}

function topKeywords(text, limit) {
  const words = (text.toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) || []).filter(
    (word) => !STOPWORDS.has(word)
  );

  const counts = new Map();
  words.forEach((word) => {
    counts.set(word, (counts.get(word) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function scoreChunk(text, keywords) {
  const normalized = text.toLowerCase();
  let score = 0;

  for (const keyword of keywords) {
    if (normalized.includes(keyword.word)) {
      score += keyword.count;
    }
  }

  if (/\b(actie|deadline|risico|besluit|conclusie|planning)\b/i.test(text)) {
    score += 4;
  }

  if (/\d/.test(text)) {
    score += 1;
  }

  return score;
}

function sampleAnalysisChunks(chunks, maxItems) {
  if (chunks.length <= maxItems) {
    return chunks;
  }

  const sampled = [];
  const step = chunks.length / maxItems;
  for (let i = 0; i < maxItems; i += 1) {
    const index = Math.floor(i * step);
    sampled.push(chunks[index]);
  }
  return sampled;
}

function answerQuestion(question) {
  if (!state.chunks.length) {
    return "Laad eerst een document.";
  }

  const normalized = question.toLowerCase();

  if (/(samenvatting|kern|hoofdpunten)/i.test(normalized)) {
    const summary = ensureSummary();
    return summary?.summaryText || "Nog geen samenvatting beschikbaar.";
  }

  if (/(deadline|wanneer|datum|planning)/i.test(normalized)) {
    const hits = sampleAnalysisChunks(state.chunks, 5000).filter((chunk) =>
      /(deadline|datum|planning|afspraak|uiterlijk|voor\s+\d)/i.test(chunk.text)
    );

    if (!hits.length) {
      return "Ik vond geen expliciete deadline in deze tekst.";
    }

    return [
      "Mogelijke planning/deadlines:",
      ...hits.slice(0, 4).map((hit) => `- ${hit.text}`),
    ].join("\n");
  }

  const tokens = (normalized.match(/[a-zà-ÿ0-9]{3,}/g) || []).filter(
    (token) => !STOPWORDS.has(token)
  );

  const scored = sampleAnalysisChunks(state.chunks, 5000)
    .map((chunk) => {
      let score = 0;
      const low = chunk.text.toLowerCase();
      tokens.forEach((token) => {
        if (low.includes(token)) {
          score += 1;
        }
      });
      return { chunk, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) {
    return "Ik kon geen direct antwoord vinden. Probeer je vraag concreter te maken.";
  }

  return [
    "Dit lijkt het meest relevant:",
    ...scored.map((entry) => `- ${entry.chunk.text}`),
  ].join("\n");
}

function renderAppVersion() {
  if (!els.appVersion) {
    return;
  }
  els.appVersion.textContent = `Versie ${APP_VERSION}`;
}

function setLoadProgress(phase, percent) {
  if (!els.loadIndicator || !els.loadPhase || !els.loadProgressFill || !els.loadProgressText) {
    return;
  }
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  els.loadIndicator.classList.remove("hidden");
  els.loadPhase.textContent = `Laden: ${phase}`;
  els.loadProgressFill.style.width = `${safePercent}%`;
  els.loadProgressText.textContent = `${safePercent}%`;
}

function setPlaybackState(nextState) {
  state.playbackState = nextState;
  if (nextState === PLAYBACK_STATES.PLAYING) {
    state.speaking = true;
    state.paused = false;
    return;
  }
  if (nextState === PLAYBACK_STATES.PAUSED) {
    state.speaking = false;
    state.paused = true;
    return;
  }
  state.speaking = false;
  state.paused = false;
}

function setStatus(message) {
  els.fileStatus.textContent = message;
}

function setPlaybackStatus(message) {
  if (!els.playbackStatus) {
    return;
  }
  els.playbackStatus.textContent = `Afspeelstatus: ${message}`;
}

function updatePlaybackProgress(forceComplete = false) {
  const total = state.activeChunks.length;
  if (!els.playerProgressFill || !els.playerProgressText) {
    return;
  }

  if (!total) {
    els.playerProgressFill.style.width = "0%";
    els.playerProgressText.textContent = "Voortgang: 0 / 0";
    return;
  }

  const safeIndex = Math.min(Math.max(state.currentIndex, 0), total - 1);
  const current = forceComplete ? total : safeIndex + 1;
  const percent = Math.round((current / total) * 100);
  els.playerProgressFill.style.width = `${percent}%`;
  els.playerProgressText.textContent = `Voortgang: ${current} / ${total}`;
}

function syncPlaybackButtons() {
  const hasAudio = state.activeChunks.length > 0;
  const isIdle = state.playbackState === PLAYBACK_STATES.IDLE;
  const isLoading = state.playbackState === PLAYBACK_STATES.LOADING;
  const isPlaying = state.playbackState === PLAYBACK_STATES.PLAYING;
  const isPaused = state.playbackState === PLAYBACK_STATES.PAUSED;
  const isStopping = state.playbackState === PLAYBACK_STATES.STOPPING;
  const isBusy = isLoading || isStopping;

  els.playBtn.disabled = !hasAudio || isPlaying || isLoading || isStopping;
  els.pauseBtn.disabled = !isPlaying && !isPaused;
  els.stopBtn.disabled = isIdle || !hasAudio;
  els.backBtn.disabled = !hasAudio || isBusy;
  els.nextHeadingBtn.disabled = !hasAudio || isBusy;
  els.pauseBtn.textContent = isPaused ? "Hervat" : "Pauze";

  if (isPaused && hasAudio) {
    els.playBtn.disabled = false;
  }
}

function shouldRetryVoiceRequest(statusCode, attempt) {
  if (attempt >= AI_RETRY_ATTEMPTS) {
    return false;
  }
  return statusCode === 429 || statusCode >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForUi() {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 16);
  });
}

async function registerServiceWorker() {
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    wireServiceWorkerUpdates(registration);
  } catch {
    // stil falen: app werkt ook zonder service worker
  }
}

function wireServiceWorkerUpdates(registration) {
  const showUpdate = (worker) => {
    if (!els.updateNotice || !worker) {
      return;
    }
    state.pendingServiceWorker = worker;
    els.updateNotice.classList.remove("hidden");
  };

  if (registration.waiting) {
    showUpdate(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) {
      return;
    }
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdate(worker);
      }
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });
}

function refreshToLatestVersion() {
  const worker = state.pendingServiceWorker;
  if (worker) {
    worker.postMessage({ type: "SKIP_WAITING" });
    return;
  }
  window.location.reload();
}

function capitalize(value) {
  if (!value) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}

const DEMO_TEXT = `LeesMee is een app voor studenten, professionals en iedereen die liever luistert dan leest.

Hoofdstuk 1: Waarom
Veel gebruikers verliezen focus bij lange documenten. Voorlezen met markering helpt om informatie beter te verwerken.

Hoofdstuk 2: Wat
De app leest documenten voor met natuurlijke stemmen, maakt samenvattingen en laat je vragen stellen over de inhoud.
Belangrijke actiepunten worden apart zichtbaar gemaakt.

Hoofdstuk 3: Hoe
Gebruikers kunnen tekst uploaden. Tijdens het luisteren kun je naar de volgende kop springen.
Er is een focusmodus voor alleen conclusies en deadlines, plus een aparte samenvattings-tab.

Conclusie
LeesMee combineert luisteren, begrijpen en onthouden in een toegankelijke workflow.`;
