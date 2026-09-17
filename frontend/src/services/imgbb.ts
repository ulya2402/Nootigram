const API_BASE = import.meta.env.VITE_API_URL || '';

function getAuthHeader(): string {
  const initData = window.Telegram?.WebApp?.initData || '';
  return `TelegramInitData ${initData}`;
}

export async function compressImage(file: File, quality = 0.75, maxWidth = 1440): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const compressed = new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), {
            type: 'image/jpeg',
          });
          resolve(compressed);
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

export async function uploadToImgbb(file: File): Promise<{ url: string; delete_url?: string }> {
  const compressed = await compressImage(file, 0.75);
  const formData = new FormData();
  formData.append('image', compressed);

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

export async function deleteFromImgbb(deleteUrl?: string): Promise<boolean> {
  if (!deleteUrl) return false;
  try {
    const response = await fetch(`${API_BASE}/api/media/delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getAuthHeader(),
      },
      body: JSON.stringify({ delete_url: deleteUrl }),
      keepalive: true,
    });
    return response.ok;
  } catch (error) {
    console.error(`API_CLIENT_ERROR deleteFromImgbb: ${(error as Error).message}`);
    return false;
  }
}