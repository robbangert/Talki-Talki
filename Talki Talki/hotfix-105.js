(() => {
  const HOTFIX_VERSION = "v2026-05-10.7";
  const TTS_RETRIES = 5;
  const TTS_RETRY_DELAY_MS = 1200;
  const TTS_FETCH_TIMEOUT_MS = 25000;
  const TTS_PATH = "/api/tts";
  const TTS_MAX_INPUT_CHARS = 520;

  const originalFetch = window.fetch.bind(window);
  const ttsControllers = new Set();
  let suppressTtsUntil = 0;
  let carryOverText = "";

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

  function clampInputText(text, maxChars) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    const candidate = normalized.slice(0, maxChars);
    const lastSpace = candidate.lastIndexOf(" ");
    if (lastSpace > Math.floor(maxChars * 0.7)) {
      return candidate.slice(0, lastSpace).trim();
    }
    return candidate.trim();
  }

  function prepareInputWindow(rawInput, maxChars) {
    const normalizedInput = String(rawInput || "").replace(/\s+/g, " ").trim();
    const merged = [carryOverText, normalizedInput].filter(Boolean).join(" ").trim();
    if (!merged) {
      return { text: "", tail: "" };
    }
    if (merged.length <= maxChars) {
      return { text: merged, tail: "" };
    }

    const head = clampInputText(merged, maxChars);
    let tail = merged.slice(head.length).trim();

    // Avoid dropping tiny endings by keeping them in the current request.
    if (tail.length > 0 && tail.length < 18 && merged.length <= maxChars + 18) {
      return { text: merged, tail: "" };
    }

    return { text: head, tail };
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
      const timeoutId = window.setTimeout(() => controller.abort("timeout"), TTS_FETCH_TIMEOUT_MS);

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

    if (payload && typeof payload.input === "string") {
      const prepared = prepareInputWindow(payload.input, TTS_MAX_INPUT_CHARS);
      payload.input = prepared.text;
      if (prepared.tail) {
        setFileStatus("Audio ophalen (stabiele modus)...");
      }
      init = { ...(init || {}), body: JSON.stringify(payload) };

      const response = await resilientTtsFetch(input, init);
      if (response.ok) {
        carryOverText = prepared.tail;
      } else {
        carryOverText = "";
      }
      return response;
    }

    return resilientTtsFetch(input, init);
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
          carryOverText = "";
        },
        true
      );
    }

    if (pauseBtn) {
      pauseBtn.addEventListener(
        "click",
        () => {
          abortAllTts("paused");
          carryOverText = "";
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
          carryOverText = "";
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
