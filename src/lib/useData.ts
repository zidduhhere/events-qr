import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage } from './api'
export function useData<T>(path: string, poll = 0) {
 const [data, setData] = useState<T | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
 const refresh = useCallback(async () => { try { setData(await api<T>(path)); setError('') } catch(e) { setError(errorMessage(e)) } finally { setLoading(false) } }, [path])
 useEffect(() => { let active = true; const load = async () => { try { const value = await api<T>(path); if (active) { setData(value); setError('') } } catch(e) { if (active) setError(errorMessage(e)) } finally { if (active) setLoading(false) } }; void load(); const id = poll ? setInterval(() => void load(), poll) : undefined; return () => { active = false; clearInterval(id) } }, [path, poll])
 return { data, error, loading, refresh }
}
