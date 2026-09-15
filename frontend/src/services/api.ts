import { NoteItem, TopicItem } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

function getAuthHeader(): string {
  const initData = window.Telegram?.WebApp?.initData || '';
  return `TelegramInitData ${initData}`;
}

export async function fetchBootstrap(): Promise<{ notes: NoteItem[]; topics: TopicItem[]; language_code?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/notes`, {
      headers: {
        Authorization: getAuthHeader(),
      },
    });
    if (!response.ok) throw new Error('FETCH_BOOTSTRAP_FAILED');
    return (await response.json()) as { notes: NoteItem[]; topics: TopicItem[]; language_code?: string };
  } catch (error) {
    console.error(`API_CLIENT_ERROR fetchBootstrap: ${(error as Error).message}`);
    return { notes: [], topics: [] };
  }
}

export async function syncNotesBatch(notes: NoteItem[]): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/notes/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ notes }),
      keepalive: true,
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR syncNotesBatch: ${(error as Error).message}`);
    return false;
  }
}

export async function deleteNoteApi(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/notes/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR deleteNoteApi: ${(error as Error).message}`);
    return false;
  }
}

export async function deleteNotesBatchApi(ids: string[]): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/notes/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ ids }),
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR deleteNotesBatchApi: ${(error as Error).message}`);
    return false;
  }
}

export async function createTopicApi(topic: TopicItem): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/topics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify(topic),
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR createTopicApi: ${(error as Error).message}`);
    return false;
  }
}

export async function deleteTopicApi(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/topics/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR deleteTopicApi: ${(error as Error).message}`);
    return false;
  }
}

export async function exportNoteToTelegram(note: NoteItem): Promise<{ success: boolean; error?: string; bot_username?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/notes/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ note_id: note.id, note }),
    });
    const result = (await response.json()) as { success: boolean; error?: string; bot_username?: string };
    return { success: Boolean(result.success), error: result.error, bot_username: result.bot_username };
  } catch (error) {
    console.error(`API_CLIENT_ERROR exportNoteToTelegram: ${(error as Error).message}`);
    return { success: false, error: 'NETWORK_ERROR' };
  }
}