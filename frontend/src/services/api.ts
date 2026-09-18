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

export async function fetchChannels(): Promise<{ channels: import('../types').ChannelItem[]; bot_username?: string }> {
  try {
    const response = await fetch(`${API_BASE}/api/channels`, {
      headers: { Authorization: getAuthHeader() },
    });
    if (!response.ok) throw new Error('FETCH_CHANNELS_FAILED');
    return (await response.json()) as { channels: import('../types').ChannelItem[]; bot_username?: string };
  } catch (error) {
    console.error(`API_CLIENT_ERROR fetchChannels: ${(error as Error).message}`);
    return { channels: [] };
  }
}

export async function uploadToCatbox(file: File): Promise<{ url: string }> {
  const workerForm = new FormData();
  workerForm.append('file', file);
  const workerRes = await fetch(`${API_BASE}/api/media/catbox`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
    },
    body: workerForm,
  });

  if (!workerRes.ok) {
    const errJson = (await workerRes.json().catch(() => ({}))) as { error?: string };
    console.error(`LITTERBOX_UPLOAD_FAILED: status=${workerRes.status}, error=${errJson.error}`);
    throw new Error(errJson.error || 'UPLOAD_FAILED');
  }

  const result = (await workerRes.json()) as { success: boolean; url: string };
  return { url: result.url };
}

export async function deleteChannelApi(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/channels/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ id }),
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR deleteChannelApi: ${(error as Error).message}`);
    return false;
  }
}

export async function exportNoteToTelegram(
  payload: any,
  options?: { target_channel_ids?: string[]; send_to_user?: boolean }
): Promise<{ success: boolean; error?: string; bot_username?: string }> {
  try {
    const noteId = payload?.note_id || payload?.id;
    const noteData = payload?.note || payload;
    const targetChannelIds = payload?.target_channel_ids || options?.target_channel_ids || [];
    const sendToUser = payload?.send_to_user !== undefined ? payload.send_to_user : (options?.send_to_user !== undefined ? options.send_to_user : true);

    const response = await fetch(`${API_BASE}/api/notes/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({
        note_id: noteId,
        note: noteData,
        target_channel_ids: targetChannelIds,
        send_to_user: sendToUser,
      }),
    });
    const result = (await response.json()) as { success: boolean; error?: string; bot_username?: string };
    return { success: Boolean(result.success), error: result.error, bot_username: result.bot_username };
  } catch (error) {
    console.error(`API_CLIENT_ERROR exportNoteToTelegram: ${(error as Error).message}`);
    return { success: false, error: 'NETWORK_ERROR' };
  }
}