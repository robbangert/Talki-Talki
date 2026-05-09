exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Only POST is allowed",
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "OPENAI_API_KEY ontbreekt in Netlify environment variables.",
    };
  }

  try {
    const ALLOWED_VOICES = new Set([
      "alloy",
      "ash",
      "ballad",
      "cedar",
      "coral",
      "echo",
      "fable",
      "marin",
      "nova",
      "onyx",
      "sage",
      "shimmer",
      "verse",
    ]);

    const payload = JSON.parse(event.body || "{}");
    const input = String(payload.input || "").trim();
    const requestedVoice = String(payload.voice || "marin").trim().toLowerCase();
    const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : "marin";
    const instructions = String(payload.instructions || "").trim();
    const speed = Number(payload.speed || 1);

    if (!input) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Tekst ontbreekt.",
      };
    }

    const clippedInput = input.slice(0, 3800);

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: clippedInput,
        instructions,
        response_format: "mp3",
        speed: Number.isFinite(speed) ? Math.min(Math.max(speed, 0.7), 1.3) : 1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: errorText || "TTS request mislukt.",
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
      body: base64,
    };
  } catch {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Onverwachte fout in tts function.",
    };
  }
};
