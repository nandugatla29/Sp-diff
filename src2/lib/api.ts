import type { AssistRequest, AssistResult, HunkAiResult, HunkAssistRequest } from '../types';

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:5100';

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Cannot reach the AI service at ${API}. Is it running?`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(data?.message || `Request failed (${res.status}).`);
  return data.result as T;
}

export const assist = (req: AssistRequest) => post<AssistResult>('/api/sp/assist', req);
export const hunkAssist = (req: HunkAssistRequest) => post<HunkAiResult>('/api/sp/hunk', req);