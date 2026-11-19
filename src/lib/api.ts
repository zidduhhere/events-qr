export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch('/api' + path, { method: options?.method ?? 'GET', headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: options?.body !== undefined ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(12000), cache: 'no-store' })
  const data = await response.json().catch(() => { throw new ApiError(response.status >= 500 ? 'The backend is unavailable. Start it with npm run dev or npm run dev:lan, and check the backend port in .env.' : 'The server returned a non-JSON API response. Check that the frontend API proxy points to the backend.', response.status) })
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed.', response.status)
  return data as T
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please retry.' }
