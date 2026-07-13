// Thin REST wrapper around Google's Gemini `generateContent` endpoint. Uses
// the GEMINI_API_KEY already in .env.local — no extra SDK needed.

const GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

// gemini-2.0-flash was retired by Google (returns 404). Default to the current
// fast model; override via GEMINI_MODEL in .env.local.
const DEFAULT_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

function requireKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local.");
  return key;
}

export type GenerateTextOptions = {
  /** Defaults to gemini-2.5-flash (override via GEMINI_MODEL env). */
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
};

/** A document/image sent alongside the prompt as an inline_data part. */
export type InlineFile = {
  mimeType: string;
  /** Raw base64 (no `data:` prefix). */
  dataBase64: string;
};

export type GenerateJsonOptions = GenerateTextOptions & {
  /** OpenAPI-subset schema Gemini must conform its response to. */
  responseSchema: Record<string, unknown>;
  /** Optional PDF/image the model reads in addition to the prompt. */
  file?: InlineFile;
};

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

type GeminiBody = {
  contents: Array<{ parts: GeminiPart[] }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number };
};

/**
 * POSTs a prepared body to `generateContent` and returns the concatenated text
 * of the first candidate. Shared by generateText and generateJson so both get
 * the same timeout, HTTP-error, safety-block, and empty-response handling.
 */
async function callGemini(
  body: GeminiBody,
  opts: { model?: string; timeoutMs?: number }
): Promise<string> {
  const key = requireKey();
  const model = opts.model ?? DEFAULT_MODEL;
  const url = `${GEMINI_API_ROOT}/${model}:generateContent?key=${encodeURIComponent(
    key
  )}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Gemini request timed out.");
    }
    throw err;
  }
  clearTimeout(timer);

  let parsed: GeminiResponse = {};
  try {
    parsed = (await response.json()) as GeminiResponse;
  } catch {
    // ignore — handled by !ok branch below
  }

  if (!response.ok) {
    const detail =
      parsed.error?.message || (await response.text().catch(() => "")) || "Unknown error";
    throw new Error(`Gemini ${response.status}: ${detail}`);
  }

  if (parsed.promptFeedback?.blockReason) {
    throw new Error(
      `Gemini blocked the prompt (${parsed.promptFeedback.blockReason}).`
    );
  }

  const text =
    parsed.candidates
      ?.flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

/**
 * Calls Gemini and returns the generated text. Throws on network/HTTP error,
 * safety blocks, or empty responses.
 */
export async function generateText(
  prompt: string,
  opts: GenerateTextOptions = {}
): Promise<string> {
  const body: GeminiBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxOutputTokens ?? 1024,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }
  return callGemini(body, opts);
}

/**
 * Calls Gemini in constrained-decoding mode and returns the parsed JSON object.
 * `responseSchema` + responseMimeType make the model emit schema-shaped JSON, so
 * no fence-stripping is needed — but a malformed body still throws rather than
 * silently yielding a partial object.
 */
export async function generateJson<T = unknown>(
  prompt: string,
  opts: GenerateJsonOptions
): Promise<T> {
  const parts: GeminiPart[] = [{ text: prompt }];
  if (opts.file) {
    parts.push({
      inline_data: { mime_type: opts.file.mimeType, data: opts.file.dataBase64 },
    });
  }

  const body: GeminiBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.1,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      responseMimeType: "application/json",
      responseSchema: opts.responseSchema,
    },
  };
  if (opts.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] };
  }

  const raw = await callGemini(body, opts);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Gemini returned a response that was not valid JSON.");
  }
}
