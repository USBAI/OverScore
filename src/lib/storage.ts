/**
 * Typed localStorage helpers with namespacing.
 * All keys are prefixed with `fbp:` to avoid clashes.
 */

const PREFIX = 'fbp:';

export function storageGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function storageSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // quota exceeded or disabled — ignore silently
  }
}

export function storageDel(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* empty */
  }
}

export function storageKeys(startsWith = ''): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX + startsWith)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* empty */
  }
  return out;
}

/** With TTL (milliseconds). Returns null if expired or missing. */
export function storageGetTtl<T>(key: string): T | null {
  const wrap = storageGet<{ expires: number; value: T }>(key);
  if (!wrap) return null;
  if (Date.now() > wrap.expires) {
    storageDel(key);
    return null;
  }
  return wrap.value;
}

export function storageSetTtl<T>(key: string, value: T, ttlMs: number): void {
  storageSet(key, { expires: Date.now() + ttlMs, value });
}
