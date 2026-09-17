const API_BASE = import.meta.env.VITE_API_URL || '';

function getAuthHeader(): string {
  const initData = window.Telegram?.WebApp?.initData || '';
  return `TelegramInitData ${initData}`;
}

export async function uploadToImgbb(file: File): Promise<{ url: string; delete_url?: string }> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE}/api/media/upload`, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
    },
    body: formData,
  });

  if (!response.ok) {
    const errData = (await response.json().catch(() => ({}))) as { error?: string };
    console.error(`MEDIA_UPLOAD_FAILED: status=${response.status}, error=${errData.error}`);
    throw new Error(errData.error || 'UPLOAD_FAILED');
  }

  const result = (await response.json()) as { success: boolean; url: string; delete_url?: string };
  return {
    url: result.url,
    delete_url: result.delete_url,
  };
}