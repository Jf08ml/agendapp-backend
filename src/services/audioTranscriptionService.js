/**
 * audioTranscriptionService.js
 *
 * Transcribe notas de voz de WhatsApp para el agente de reservas. Claude no
 * acepta audio como entrada, así que el audio pasa primero por OpenAI
 * (gpt-4o-mini-transcribe) y el bot recibe el texto.
 *
 * Requiere OPENAI_API_KEY. Sin la clave (o si OpenAI falla) devuelve null y el
 * bot le pide al cliente que escriba el mensaje.
 */

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const TIMEOUT_MS = 45_000;
// Límite de OpenAI por archivo: 25 MB.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Extensión para el nombre del archivo: OpenAI decide el formato por ella.
// Las notas de voz de WhatsApp llegan como audio/ogg (codecs=opus).
const EXTENSIONS = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
};

export const isTranscriptionConfigured = () => !!process.env.OPENAI_API_KEY;

// Cómo queda una nota de voz en el historial del asistente de reservas (web y
// WhatsApp). isExplicitConfirmation (tools/reservation.js) quita este prefijo.
export const VOICE_NOTE_PREFIX = "🎤 (nota de voz)";
export const VOICE_NOTE_FAILED = "🎤 (nota de voz — no se pudo transcribir)";
export const VOICE_FAIL_REPLY = "No pude escuchar tu nota de voz 🙏 ¿Me lo escribes por aquí?";

/**
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<string|null>} texto transcrito, o null si no se pudo
 */
export async function transcribeAudio(buffer, mimeType) {
  if (!isTranscriptionConfigured()) {
    console.warn("[Transcripción] OPENAI_API_KEY no configurada — no se transcriben notas de voz");
    return null;
  }
  if (!buffer?.length || buffer.length > MAX_AUDIO_BYTES) return null;

  // "audio/webm;codecs=opus" (grabación del navegador) → "audio/webm"
  const type = String(mimeType || "").split(";")[0].trim().toLowerCase() || "audio/ogg";
  const ext = EXTENSIONS[type] || "ogg";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type }), `nota.${ext}`);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "es");
  form.append("response_format", "json");

  try {
    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[Transcripción] OpenAI respondió ${res.status}: ${detail.slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    const text = String(data?.text || "").trim();
    return text || null;
  } catch (err) {
    console.error("[Transcripción] Error llamando a OpenAI:", err.message);
    return null;
  }
}
