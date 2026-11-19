const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Valida un token de Cloudflare Turnstile (registro y recuperación de acceso).
 * En dev sin secret configurado, se salta la validación.
 */
export async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // En dev sin Turnstile configurado, permitir
    if (process.env.NODE_ENV !== "production") return true;
    throw new Error("Turnstile no configurado");
  }
  if (!token) return false;

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });

  const data = await response.json();
  return data.success === true;
}
