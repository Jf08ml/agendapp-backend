// Lectura de rebotes de correo (DSN, RFC 3464) sin dependencias, para poder
// probarla con `node --test`. Los rebotes llegan al buzón hola@agenditapp.com
// (relay de Hostinger = MailChannels, Postfix) como multipart/report con una
// parte message/delivery-status:
//
//   Final-Recipient: rfc822; alguien@gmail.com
//   Action: failed
//   Status: 5.1.1
//   Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist...
//
// Si esa parte no está, se cae al texto que escribe Postfix:
//   <alguien@gmail.com>: host ... said: 550-5.1.1 The email account ...

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Desdobla encabezados partidos en varias líneas y quita los saltos suaves de quoted-printable. */
function normalize(raw) {
  return String(raw ?? "")
    .replace(/=\r?\n/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]+/g, " ");
}

function field(block, name) {
  const m = block.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/** "smtp; 550-5.1.1 The email account…" → texto legible y corto. */
function cleanDiagnostic(value) {
  if (!value) return null;
  return value
    .replace(/^[a-z-]+;\s*/i, "")
    .replace(/\b\d{3}[- ]\d\.\d\.\d+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || null;
}

/**
 * @param {string} raw - fuente completa del correo de rebote
 * @returns {Array<{ recipient: string, status: string|null, permanent: boolean, diagnostic: string|null }>}
 */
export function parseBounce(raw) {
  const text = normalize(raw);
  const results = [];
  const seen = new Set();
  let hasDsn = false;

  for (const block of text.split(/\n\s*\n/)) {
    const finalRecipient = field(block, "Final-Recipient");
    if (!finalRecipient) continue;
    hasDsn = true;
    const recipient = finalRecipient.match(EMAIL_RE)?.[0]?.toLowerCase();
    if (!recipient || seen.has(recipient)) continue;
    const action = (field(block, "Action") || "").toLowerCase();
    const status = field(block, "Status")?.match(/\d\.\d{1,3}\.\d{1,3}/)?.[0] || null;
    // "delayed" / "delivered" / "relayed" no son rebotes.
    if (action && action !== "failed") continue;
    seen.add(recipient);
    results.push({
      recipient,
      status,
      permanent: status ? status.startsWith("5") : action === "failed",
      diagnostic: cleanDiagnostic(field(block, "Diagnostic-Code")),
    });
  }
  // Si hubo parte delivery-status, ella manda (p. ej. un aviso de demora no es rebote).
  if (hasDsn) return results;

  // Sin parte delivery-status: formato de texto de Postfix.
  const re = /<([^>\s]+@[^>\s]+)>:\s*([\s\S]*?)(?=\n\s*\n|\n<[^>\s]+@|$)/g;
  let m;
  while ((m = re.exec(text))) {
    const recipient = m[1].toLowerCase();
    if (seen.has(recipient) || !EMAIL_RE.test(recipient)) continue;
    const body = m[2];
    const status = body.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1] || null;
    const smtpCode = body.match(/\b([245])\d{2}[- ]/)?.[1];
    const permanent = status ? status.startsWith("5") : smtpCode === "5";
    if (!permanent) continue;
    seen.add(recipient);
    const said = body.split(/said:/i)[1] ?? body;
    results.push({ recipient, status, permanent, diagnostic: cleanDiagnostic(said.replace(/\(in reply to [^)]*\)/i, "")) });
  }
  return results;
}

/** ¿Este correo parece un aviso de no entrega? (remitente o asunto típicos). */
export function looksLikeBounce({ from, subject, contentType } = {}) {
  const f = String(from ?? "").toLowerCase();
  const s = String(subject ?? "").toLowerCase();
  const ct = String(contentType ?? "").toLowerCase();
  return (
    ct.includes("multipart/report") ||
    /mailer-daemon|postmaster/.test(f) ||
    /undeliver|returned to sender|delivery status notification|failure notice|no se pudo entregar|no entregado/.test(s)
  );
}
