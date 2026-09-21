import { Env, NotePayload, TopicPayload } from '../types';
import { TelegramService } from '../services/telegram';

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN);

  const authHeader = request.headers.get('Authorization') || '';
  const initData = authHeader.replace(/^TelegramInitData\s+/, '');
  const authUser = await telegram.validateInitData(initData);

  if (!authUser && env.ENVIRONMENT === 'production') {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED_INIT_DATA' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = authUser ? (authUser.id as number) : 123456789;

  if (request.method === 'GET' && path === '/api/notes') {
    try {
      const results = await env.DB.batch([
        env.DB.prepare('SELECT language_code FROM users WHERE telegram_id = ?').bind(userId),
        env.DB.prepare('SELECT id, name, is_default FROM topics WHERE telegram_id = ? ORDER BY created_at ASC').bind(userId),
        env.DB.prepare("SELECT id, category, title, content_raw, blocks_json, is_pinned, strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updated_at FROM notes WHERE telegram_id = ? ORDER BY updated_at DESC").bind(userId),
      ]);

      const userRow = results[0].results[0] as { language_code?: string } | undefined;
      const rawTopics = results[1].results as unknown as { id: string; name: string; is_default: number | boolean }[];
      const rawNotes = results[2].results as unknown as {
        id: string;
        category: string;
        title: string;
        content_raw: string;
        blocks_json: string;
        is_pinned: number | boolean;
        updated_at: string;
      }[];

      let finalTopics = rawTopics.map((t) => ({
        id: t.id,
        name: t.name,
        is_default: Boolean(t.is_default),
      }));

      if (finalTopics.length === 0) {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO topics (id, telegram_id, name, is_default) VALUES (?, ?, ?, ?)').bind('ideas', userId, 'Ide', 1),
          env.DB.prepare('INSERT INTO topics (id, telegram_id, name, is_default) VALUES (?, ?, ?, ?)').bind('projects', userId, 'Proyek', 1),
        ]);
        finalTopics = [
          { id: 'ideas', name: 'Ide', is_default: true },
          { id: 'projects', name: 'Proyek', is_default: true },
        ];
      }

      const notes = rawNotes.map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        content_raw: r.content_raw,
        blocks: JSON.parse(r.blocks_json),
        is_pinned: Boolean(r.is_pinned),
        is_favorite: Boolean(r.is_pinned),
        updated_at_str: r.updated_at,
      }));

      return new Response(
        JSON.stringify({
          notes,
          topics: finalTopics,
          language_code: userRow?.language_code || 'en',
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error(`API_GET_BOOTSTRAP_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/notes/batch') {
    try {
      const body = (await request.json()) as { notes: NotePayload[] };
      const statements: D1PreparedStatement[] = [];

      for (const note of body.notes) {
        const isPinnedValue = (note as any).is_favorite !== undefined ? ((note as any).is_favorite ? 1 : 0) : (note.is_pinned ? 1 : 0);
        statements.push(
          env.DB.prepare(`
            INSERT INTO notes (id, telegram_id, category, title, content_raw, blocks_json, is_pinned, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
              category = excluded.category,
              title = excluded.title,
              content_raw = excluded.content_raw,
              blocks_json = excluded.blocks_json,
              is_pinned = excluded.is_pinned,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            note.id,
            userId,
            note.category,
            note.title,
            note.content_raw || '',
            JSON.stringify(note.blocks || []),
            isPinnedValue
          )
        );
      }

      if (statements.length > 0) {
        await env.DB.batch(statements);
      }

      return new Response(JSON.stringify({ success: true, count: statements.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_BATCH_NOTES_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'TRANSACTION_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/notes/delete') {
    try {
      const body = (await request.json()) as { id?: string; ids?: string[] };
      if (body.ids && Array.isArray(body.ids) && body.ids.length > 0) {
        const statements = body.ids.map((nId) =>
          env.DB.prepare('DELETE FROM notes WHERE id = ? AND telegram_id = ?').bind(nId, userId)
        );
        await env.DB.batch(statements);
        console.log(`BATCH_NOTES_DELETED_SUCCESS: count=${body.ids.length}, user=${userId}`);
      } else if (body.id) {
        await env.DB.prepare('DELETE FROM notes WHERE id = ? AND telegram_id = ?').bind(body.id, userId).run();
        console.log(`NOTE_DELETED_SUCCESS: note_id=${body.id}, user=${userId}`);
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_DELETE_NOTE_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'DELETE_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/topics') {
    try {
      const topic = (await request.json()) as TopicPayload;
      await env.DB.prepare('INSERT INTO topics (id, telegram_id, name, is_default) VALUES (?, ?, ?, ?)')
        .bind(topic.id, userId, topic.name, topic.is_default ? 1 : 0)
        .run();

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_CREATE_TOPIC_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'TOPIC_CREATE_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/topics/delete') {
    try {
      const body = (await request.json()) as { id: string };
      await env.DB.batch([
        env.DB.prepare('DELETE FROM topics WHERE id = ? AND telegram_id = ? AND is_default = 0').bind(body.id, userId),
        env.DB.prepare('UPDATE notes SET category = "ideas" WHERE category = ? AND telegram_id = ?').bind(body.id, userId),
      ]);

      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_DELETE_TOPIC_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'TOPIC_DELETE_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'GET' && path === '/api/channels') {
    try {
      const rows = await env.DB.prepare('SELECT id, title, username, photo_url FROM channels WHERE telegram_id = ? ORDER BY created_at ASC')
        .bind(userId)
        .all();
      const botUsername = await telegram.getBotUsername();
      return new Response(
        JSON.stringify({ channels: rows.results, bot_username: botUsername }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error(`API_GET_CHANNELS_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/channels/delete') {
    try {
      const body = (await request.json()) as { id: string };
      await env.DB.prepare('DELETE FROM channels WHERE (id = ? OR id = ?) AND telegram_id = ?')
        .bind(body.id, body.id.replace(/^-100/, '-'), userId)
        .run();
      console.log(`CHANNEL_DELETED_SUCCESS: channel=${body.id}, user=${userId}`);
      await telegram.leaveChat(body.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_DELETE_CHANNEL_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'DELETE_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/notes/export') {
    try {
      const payload = (await request.json()) as {
        note_id: string;
        note?: NotePayload;
        target_channel_ids?: string[];
        send_to_user?: boolean;
      };
      let blocks: any[] = [];
      if (payload.note && payload.note.blocks) {
        blocks = payload.note.blocks;
      } else {
        const row = await env.DB.prepare('SELECT * FROM notes WHERE id = ? AND telegram_id = ?')
          .bind(payload.note_id, userId)
          .first();
        if (!row) {
          return new Response(JSON.stringify({ error: 'NOTE_NOT_FOUND' }), { status: 404 });
        }
        blocks = JSON.parse(row.blocks_json as string);
      }

      let userSuccess = true;
      if (payload.send_to_user !== false) {
        const userResult = await telegram.sendRichMessage(userId, { blocks });
        if (!userResult.ok && userResult.errorCode === 403) {
          const botUsername = await telegram.getBotUsername();
          return new Response(JSON.stringify({ success: false, error: 'NEED_START_BOT', bot_username: botUsername }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        userSuccess = userResult.ok;
      }

      console.log(`[EXPORT] Received request: userId=${userId}, note_id=${payload.note_id}, target_channel_ids=${JSON.stringify(payload.target_channel_ids)}, send_to_user=${payload.send_to_user}`);

      const channelIds = Array.isArray(payload.target_channel_ids) ? payload.target_channel_ids : [];
      let channelSuccessCount = 0;

      for (const chId of channelIds) {
        console.log(`[EXPORT] Checking channel authorization: chId=${chId}, userId=${userId}`);
        const verifyRow = await env.DB.prepare('SELECT id FROM channels WHERE (id = ? OR id = ?) AND telegram_id = ?')
          .bind(chId, chId.replace(/^-100/, '-'), userId)
          .first();

        if (verifyRow) {
          const normalizedTarget = chId.startsWith('-100') ? chId : chId.startsWith('-') ? `-100${chId.slice(1)}` : `-100${chId}`;
          console.log(`[EXPORT] Authorized channel found. Sending message to ${normalizedTarget}`);
          const chResult = await telegram.sendRichMessage(normalizedTarget, { blocks });
          console.log(`[EXPORT] Channel send result: target=${normalizedTarget}, ok=${chResult.ok}, code=${chResult.errorCode}, desc=${chResult.description}`);
          if (chResult.ok) channelSuccessCount++;
        } else {
          console.warn(`[EXPORT] Channel not found or unauthorized: chId=${chId}, userId=${userId}`);
        }
      }

      const isOverallSuccess = channelIds.length > 0 ? channelSuccessCount > 0 : userSuccess;
      console.log(`[EXPORT] Completed: isOverallSuccess=${isOverallSuccess}, channelSuccessCount=${channelSuccessCount}`);
      return new Response(JSON.stringify({ success: isOverallSuccess, channels_posted: channelSuccessCount }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`[EXPORT] Exception occurred: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'EXPORT_FAILED' }), { status: 500 });
    }
  }
  if (request.method === 'POST' && path === '/api/media/supabase') {
    try {
      const configs = (env.SUPABASE_CONFIGS || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      if (configs.length === 0) {
        console.error('SUPABASE_NOT_CONFIGURED');
        return new Response(JSON.stringify({ error: 'SUPABASE_NOT_CONFIGURED' }), { status: 500 });
      }

      const formData = await request.formData();
      const file = formData.get('file') as unknown as File | null;

      if (!file || typeof (file as any).arrayBuffer !== 'function') {
        return new Response(JSON.stringify({ error: 'INVALID_FILE' }), { status: 400 });
      }

      if (file.size > 10 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'FILE_TOO_LARGE' }), { status: 400 });
      }

      let lastError = '';

      for (let i = 0; i < configs.length; i++) {
        const parts = configs[i].split('|');
        if (parts.length !== 3) continue;

        const projectUrl = parts[0].trim();
        const secretKey = parts[1].trim();
        const bucketName = parts[2].trim();

        try {
          const originalExt = file.name.split('.').pop() || 'bin';
          const safeFileName = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${originalExt}`;
          const fileType = file.type || 'application/octet-stream';
          const uploadUrl = `${projectUrl}/storage/v1/object/${bucketName}/${safeFileName}`;
          
          const fileBuffer = await file.arrayBuffer();

          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${secretKey}`,
              apikey: secretKey,
              'Content-Type': fileType,
            },
            body: fileBuffer,
          });

          const uploadData = (await uploadRes.json()) as any;

          if (uploadRes.ok) {
            const finalUrl = `${projectUrl}/storage/v1/object/public/${bucketName}/${safeFileName}`;
            return new Response(JSON.stringify({ success: true, url: finalUrl }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          lastError = uploadData.message || uploadData.error || `UPLOAD_HTTP_${uploadRes.status}`;
          console.warn(`SUPABASE_UPLOAD_FAILED: index=${i}, error=${lastError}`);
        } catch (err) {
          lastError = (err as Error).message;
          console.warn(`SUPABASE_REQ_EXCEPTION: index=${i}, error=${lastError}`);
        }
      }

      console.error(`SUPABASE_ALL_CONFIGS_FAILED: ${lastError}`);
      return new Response(JSON.stringify({ error: 'UPLOAD_FAILED' }), { status: 502 });
    } catch (error) {
      console.error(`API_MEDIA_SUPABASE_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'UPLOAD_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/media/upload') {
    try {
      const keys = (env.IMGBB_API_KEYS || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);

      if (keys.length === 0) {
        console.error('IMGBB_NOT_CONFIGURED: IMGBB_API_KEYS is missing in env');
        return new Response(JSON.stringify({ error: 'IMGBB_NOT_CONFIGURED' }), { status: 500 });
      }

      const formData = await request.formData();
      const imageFile = formData.get('image') as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> } | null;
      if (!imageFile || typeof imageFile.arrayBuffer !== 'function') {
        return new Response(JSON.stringify({ error: 'INVALID_FILE' }), { status: 400 });
      }

      const fileBuffer = await imageFile.arrayBuffer();
      const imageBlob = new Blob([fileBuffer]);

      let lastError = '';
      for (let i = 0; i < keys.length; i++) {
        const currentKey = keys[i];
        try {
          const imgbbForm = new FormData();
          imgbbForm.append('image', imageBlob, 'upload.jpg');

          const imgbbRes = await fetch(`https://api.imgbb.com/1/upload?key=${currentKey}`, {
            method: 'POST',
            body: imgbbForm,
          });

          const data = (await imgbbRes.json()) as {
            success?: boolean;
            data?: { url: string; delete_url?: string };
            error?: { message: string };
          };

          if (imgbbRes.ok && data.success && data.data?.url) {
            return new Response(
              JSON.stringify({
                success: true,
                url: data.data.url,
                delete_url: data.data.delete_url,
              }),
              {
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
          lastError = data.error?.message || `HTTP_${imgbbRes.status}`;
          console.warn(`IMGBB_KEY_FAILED: index=${i}, error=${lastError}`);
        } catch (err) {
          lastError = (err as Error).message;
          console.warn(`IMGBB_REQ_EXCEPTION: index=${i}, error=${lastError}`);
        }
      }

      console.error(`IMGBB_ALL_KEYS_FAILED: ${lastError}`);
      return new Response(JSON.stringify({ error: 'ALL_KEYS_EXHAUSTED' }), { status: 502 });
    } catch (error) {
      console.error(`API_MEDIA_UPLOAD_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'UPLOAD_FAILED' }), { status: 500 });
    }
  }

  if (request.method === 'POST' && path === '/api/media/delete') {
    try {
      const body = (await request.json()) as { delete_url?: string };
      if (!body.delete_url || !body.delete_url.startsWith('https://ibb.co/')) {
        return new Response(JSON.stringify({ error: 'INVALID_URL' }), { status: 400 });
      }
      const pageRes = await fetch(body.delete_url);
      const html = await pageRes.text();
      const tokenMatch = html.match(/auth_token\s*=\s*["']([a-f0-9]+)["']/i) || html.match(/name="auth_token"\s+value="([^"]+)"/i);
      const authToken = tokenMatch ? tokenMatch[1] : '';
      const formBody = new URLSearchParams();
      formBody.append('action', 'delete');
      if (authToken) {
        formBody.append('auth_token', authToken);
      }
      const delRes = await fetch(body.delete_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      });
      return new Response(JSON.stringify({ success: delRes.ok }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_MEDIA_DELETE_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'DELETE_FAILED' }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
}