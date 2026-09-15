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
        env.DB.prepare("SELECT id, category, title, content_raw, blocks_json, is_pinned, strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) AS updated_at FROM notes WHERE telegram_id = ? ORDER BY is_pinned DESC, updated_at DESC").bind(userId),
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
            note.is_pinned ? 1 : 0
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

  if (request.method === 'POST' && path === '/api/notes/export') {
    try {
      const payload = (await request.json()) as { note_id: string; note?: NotePayload };
      let blocks: any[] = [];

      if (payload.note && payload.note.blocks) {
        blocks = payload.note.blocks;
        await env.DB.prepare(`
          INSERT INTO notes (id, telegram_id, category, title, content_raw, blocks_json, is_pinned, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            blocks_json = excluded.blocks_json,
            updated_at = CURRENT_TIMESTAMP
        `)
          .bind(
            payload.note.id,
            userId,
            payload.note.category,
            payload.note.title,
            payload.note.content_raw || '',
            JSON.stringify(payload.note.blocks),
            payload.note.is_pinned ? 1 : 0
          )
          .run();
      } else {
        const row = await env.DB.prepare('SELECT * FROM notes WHERE id = ? AND telegram_id = ?')
          .bind(payload.note_id, userId)
          .first();

        if (!row) {
          return new Response(JSON.stringify({ error: 'NOTE_NOT_FOUND' }), { status: 404 });
        }
        blocks = JSON.parse(row.blocks_json as string);
      }

      const sendResult = await telegram.sendRichMessage(userId, { blocks });
      if (!sendResult.ok && sendResult.errorCode === 403) {
        const botUsername = await telegram.getBotUsername();
        return new Response(JSON.stringify({ success: false, error: 'NEED_START_BOT', bot_username: botUsername }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ success: sendResult.ok }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error(`API_EXPORT_NOTE_ERROR: ${(error as Error).message}`);
      return new Response(JSON.stringify({ error: 'EXPORT_FAILED' }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 });
}