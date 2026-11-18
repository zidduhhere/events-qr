export function readLocal(key: string, fallback = '') { try { return localStorage.getItem('tablepass.' + key) ?? fallback } catch { return fallback } }
export function writeLocal(key: string, value: string) { localStorage.setItem('tablepass.' + key, value) }
export function deviceLabel() { return readLocal('device') }
