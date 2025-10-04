// services/waHttpService.js
const WA_API_URL = process.env.WA_API_URL;
const WA_API_KEY = process.env.WA_API_KEY;

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": WA_API_KEY,
  };
}

export async function waStartSession(clientId) {
  const r = await fetch(`${WA_API_URL}/api/session`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ clientId }),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = (data && data.error) || r.statusText;
    throw new Error(`WA /api/session ${r.status}: ${msg}`);
  }
  return data;
}

export async function waGetStatus(clientId) {
  const r = await fetch(
    `${WA_API_URL}/api/status/${encodeURIComponent(clientId)}`,
    {
      method: "GET",
      headers: headers(),
    }
  );
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = (data && data.error) || r.statusText;
    throw new Error(`WA /api/status ${r.status}: ${msg}`);
  }
  return data;
}

// ⬇️ NUEVO: enviar mensaje
export async function waSend({ clientId, phone, message, image }) {
  const r = await fetch(`${WA_API_URL}/api/send`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ clientId, phone, message, image }),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = (data && data.error) || r.statusText;
    throw new Error(`WA /api/send ${r.status}: ${msg}`);
  }
  return data; // { status:"sent", id, kind } o error
}

// ⬇️ NUEVO: reiniciar sesión
export async function waRestart(clientId) {
  const r = await fetch(`${WA_API_URL}/api/restart`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ clientId }),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = (data && data.error) || r.statusText;
    throw new Error(`WA /api/restart ${r.status}: ${msg}`);
  }
  return data;
}

// ⬇️ NUEVO: cerrar sesión (logout + limpiar credenciales)
export async function waLogout(clientId) {
  const r = await fetch(`${WA_API_URL}/api/logout`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ clientId }),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok) {
    const msg = (data && data.error) || r.statusText;
    throw new Error(`WA /api/logout ${r.status}: ${msg}`);
  }
  return data;
}

export async function waBulkSend({
  clientId,
  title,
  items,
  messageTpl,
  image,
  dryRun = false,
}) {
  const r = await fetch(`${WA_API_URL}/api/bulk/send`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ clientId, title, items, messageTpl, image, dryRun }),
  });
  let data = null;
  try {
    data = await r.json();
  } catch {}
  if (!r.ok)
    throw new Error(
      `WA /bulk/send ${r.status}: ${(data && data.error) || r.statusText}`
    );
  return data; // => { ok:true, bulkId, prepared }
}

// Opcional: cargar consentimiento antes de enviar
export async function waBulkOptIn(phones = []) {
  if (!phones.length) return { ok: true, count: 0 };
  const r = await fetch(`${WA_API_URL}/api/bulk/optin`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ phones }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `WA /bulk/optin ${r.status}: ${(data && data.error) || r.statusText}`
    );
  return data;
}

export async function waBulkOptOut(phones = []) {
  if (!phones.length) return { ok: true, count: 0 };
  const r = await fetch(`${WA_API_URL}/api/bulk/optout`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ phones }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `WA /bulk/optout ${r.status}: ${(data && data.error) || r.statusText}`
    );
  return data;
}

// Opcional: consultar estado/detalle
export async function waBulkGet(bulkId) {
  const r = await fetch(
    `${WA_API_URL}/api/bulk/${encodeURIComponent(bulkId)}`,
    {
      method: "GET",
      headers: headers(),
    }
  );
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      `WA GET /bulk/${bulkId} ${r.status}: ${
        (data && data.error) || r.statusText
      }`
    );
  return data;
}
