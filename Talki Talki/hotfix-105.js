(() => {
  const HOTFIX_VERSION = "v2026-05-10.5";
  const TTS_RETRIES = 5;
  const TTS_RETRY_DELAY_MS = 1200;
  const TTS_FETCH_TIMEOUT_MS = 25000;
  const TTS_PATH = "/api/tts";
  const TTS_MAX_INPUT_CHARS = 420;

  const originalFetch = window.fetch.bind(window);
  const ttsControllers = new Set();
  let suppressTtsUntil = 0;
  let decodeContext = null;

  function now() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isAbortError(error) {
    return Boolean(error && typeof error === "object" && error.name === "AbortError");
  }

  function requestUrl(input) {
    if (typeof input === "string") {
      return input;
    }
    if (input && typeof input.url === "string") {
      return input.url;
    }
    return "";
  }

  function isTtsRequest(input) {
    const url = requestUrl(input);
    return url.includes(TTS_PATH);
  }

  function getDecodeContext() {
    if (decodeContext) {
      return decodeContext;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return null;
    }
    decodeContext = new Ctx();
    return decodeContext;
  }

  function setPlaybackStatus(message) {
    const el = document.querySelector("#playbackStatus");
    if (!el) {
      return;
    }
    el.textContent = `Afspeelstatus: ${message}`;
  }

  function setFileStatus(message) {
    const el = document.querySelector("#fileStatus");
    if (!el) {
      return;
    }
    el.textContent = message;
  }

  function abortAllTts(reason) {
    suppressTtsUntil = now() + 7000;
    ttsControllers.forEach((controller) => {
      try {
        controller.abort(reason);
      } catch {
        // no-op
      }
    });
    ttsControllers.clear();
  }

  function clearSuppression() {
    suppressTtsUntil = 0;
  }

  function splitTextForTts(text, maxChars = TTS_MAX_INPUT_CHARS) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return [];
    }
    if (normalized.length <= maxChars) {
      return [normalized];
    }

    const pieces = [];
    const sentences = normalized.split(/(?<=[.!?])\s+/);
    let current = "";

    for (const sentence of sentences) {
      if (!sentence) {
        continue;
      }
      if (sentence.length > maxChars) {
        if (current) {
          pieces.push(current.trim());
          current = "";
        }
        let rest = sentence;
        while (rest.length > maxChars) {
          pieces.push(rest.slice(0, maxChars).trim());
          rest = rest.slice(maxChars);
        }
        if (rest.trim()) {
          current = rest.trim();
        }
        continue;
      }

      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxChars) {
        if (current) {
          pieces.push(current.trim());
        }
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) {
      pieces.push(current.trim());
    }

    return pieces.filter(Boolean);
  }

  async function decodeToAudioBuffer(arrayBuffer) {
    const context = getDecodeContext();
    if (!context) {
      throw new Error("AudioContext niet beschikbaar");
    }
    const copy = arrayBuffer.slice(0);
    return context.decodeAudioData(copy);
  }

  function mergeAudioBuffers(buffers) {
    const context = getDecodeContext();
    if (!context || !buffers.length) {
      throw new Error("Kan audio niet samenvoegen");
    }

    const sampleRate = buffers[0].sampleRate;
    const channels = buffers[0].numberOfChannels;
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const merged = context.createBuffer(channels, totalLength, sampleRate);

    let offset = 0;
    buffers.forEach((buffer) => {
      for (let channel = 0; channel < channels; channel += 1) {
        merged.getChannelData(channel).set(buffer.getChannelData(channel), offset);
      }
      offset += buffer.length;
    });

    return merged;
  }

  function encodeWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.length;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(offset, text) {
      for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let writeOffset = 44;
    const channelData = [];
    for (let channel = 0; channel < numChannels; channel += 1) {
      channelData.push(audioBuffer.getChannelData(channel));
    }

    for (let i = 0; i < samples; i += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        let sample = channelData[channel][i];
        sample = Math.max(-1, Math.min(1, sample));
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        view.setInt16(writeOffset, intSample, true);
        writeOffset += 2;
      }
    }

    return buffer;
  }

  async function resilientTtsFetch(input, init = {}) {
    if (now() < suppressTtsUntil) {
      throw new DOMException("Suppressed by user action", "AbortError");
    }

    for (let attempt = 1; attempt <= TTS_RETRIES; attempt += 1) {
      if (now() < suppressTtsUntil) {
        throw new DOMException("Suppressed by user action", "AbortError");
      }

      const controller = new AbortController();
      ttsControllers.add(controller);

      const timeoutId = window.setTimeout(() => {
        controller.abort("timeout");
      }, TTS_FETCH_TIMEOUT_MS);

      const mergedInit = { ...init, signal: controller.signal };
      const sourceSignal = init && init.signal;
      if (sourceSignal) {
        if (sourceSignal.aborted) {
          controller.abort(sourceSignal.reason);
        } else {
          sourceSignal.addEventListener(
            "abort",
            () => {
              controller.abort(sourceSignal.reason);
            },
            { once: true }
          );
        }
      }

      try {
        const response = await originalFetch(input, mergedInit);
        if (response.ok) {
          return response;
        }

        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < TTS_RETRIES) {
          await sleep(TTS_RETRY_DELAY_MS * attempt);
          continue;
        }
        return response;
      } catch (error) {
        if (isAbortError(error) && now() < suppressTtsUntil) {
          throw error;
        }

        if (attempt < TTS_RETRIES) {
          await sleep(TTS_RETRY_DELAY_MS * attempt);
          continue;
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
        ttsControllers.delete(controller);
      }
    }

    throw new Error("AI-stem ophalen mislukt na meerdere pogingen.");
  }

  window.fetch = async function patchedFetch(input, init) {
    if (!isTtsRequest(input)) {
      return originalFetch(input, init);
    }

    let payload = null;
    if (init && typeof init.body === "string") {
      try {
        payload = JSON.parse(init.body);
      } catch {
        payload = null;
      }
    }

    const inputText = payload && typeof payload.input === "string" ? payload.input : "";
    const needsSplit = inputText.length > TTS_MAX_INPUT_CHARS;

    if (!needsSplit) {
      return resilientTtsFetch(input, init);
    }

    const segments = splitTextForTts(inputText);
    if (!segments.length) {
      return resilientTtsFetch(input, init);
    }

    setFileStatus(`Audio ophalen in ${segments.length} delen...`);
    const audioParts = [];

    for (let i = 0; i < segments.length; i += 1) {
      if (now() < suppressTtsUntil) {
        throw new DOMException("Suppressed by user action", "AbortError");
      }

      const segmentPayload = { ...payload, input: segments[i] };
      const segmentInit = { ...(init || {}), body: JSON.stringify(segmentPayload) };
      const response = await resilientTtsFetch(input, segmentInit);
      if (!response.ok) {
        return response;
      }
      audioParts.push(await response.arrayBuffer());
    }

    try {
      const decoded = [];
      for (const audioPart of audioParts) {
        decoded.push(await decodeToAudioBuffer(audioPart));
      }
      const merged = mergeAudioBuffers(decoded);
      const wav = encodeWav(merged);
      return new Response(wav, {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
        },
      });
    } catch {
      // Fallback: geef tenminste het eerste audiodeel terug als samenvoegen niet lukt.
      return new Response(audioParts[0], {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
        },
      });
    }
  };

  function wireButtons() {
    const playBtn = document.querySelector("#playBtn");
    const pauseBtn = document.querySelector("#pauseBtn");
    const stopBtn = document.querySelector("#stopBtn");
    const rateRange = document.querySelector("#rateRange");
    const rateValue = document.querySelector("#rateValue");
    const versionPill = document.querySelector(".version-pill");

    if (versionPill) {
      versionPill.textContent = `Versie ${HOTFIX_VERSION}`;
    }

    if (rateRange) {
      rateRange.value = "1";
      rateRange.dispatchEvent(new Event("input", { bubbles: true }));
      if (rateValue) {
        rateValue.textContent = "1.0x";
      }
    }

    if (playBtn) {
      playBtn.addEventListener(
        "click",
        () => {
          clearSuppression();
        },
        true
      );
    }

    if (pauseBtn) {
      pauseBtn.addEventListener(
        "click",
        () => {
          abortAllTts("paused");
          setPlaybackStatus("Gepauzeerd");
          setFileStatus("Voorlezen gepauzeerd.");
        },
        true
      );
    }

    if (stopBtn) {
      stopBtn.addEventListener(
        "click",
        () => {
          abortAllTts("stopped");
          setPlaybackStatus("Gestopt");
          setFileStatus("Voorlezen gestopt.");
        },
        true
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireButtons, { once: true });
  } else {
    wireButtons();
  }
})();
