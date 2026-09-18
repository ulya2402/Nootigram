import { Env, TelegramUpdate } from '../types';
import { TelegramService } from '../services/telegram';
import { t } from '../services/i18n';

export async function handleBotUpdate(update: TelegramUpdate, env: Env): Promise<Response> {
  const telegram = new TelegramService(env.TELEGRAM_BOT_TOKEN);

  try {
    if (update.message?.text) {
      const message = update.message;
      const text = message.text?.trim() || '';
      const userId = message.from.id;

      let user = await env.DB.prepare('SELECT * FROM users WHERE telegram_id = ?')
        .bind(userId)
        .first<{ telegram_id: number; language_code: string }>();

      if (!user) {
        await env.DB.prepare(
          'INSERT INTO users (telegram_id, language_code, first_name, last_name, username) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(
            userId,
            'en',
            message.from.first_name || '',
            message.from.last_name || null,
            message.from.username || null
          )
          .run();
        user = { telegram_id: userId, language_code: 'en' };
      }

      const lang = user.language_code;

      if (text.startsWith('/start')) {
        const welcomeText = t(lang, 'bot_welcome', { name: message.from.first_name });
        const keyboard = {
          inline_keyboard: [
            [
              {
                text: t(lang, 'open_app'),
                web_app: { url: env.WEBAPP_URL },
              },
            ],
          ],
        };
        await telegram.sendMessage(message.chat.id, welcomeText, keyboard);
        return new Response('OK', { status: 200 });
      }

      if (text.startsWith('/lang')) {
        const selectText = t(lang, 'select_lang');
        const keyboard = {
          inline_keyboard: [
            [
              { text: '🇮🇩 Bahasa Indonesia', callback_data: 'set_lang_id' },
              { text: '🇬🇧 English', callback_data: 'set_lang_en' },
            ],
          ],
        };
        await telegram.sendMessage(message.chat.id, selectText, keyboard);
        return new Response('OK', { status: 200 });
      }
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const userId = cq.from.id;
      const data = cq.data;
      if (typeof data === 'string' && data.startsWith('set_lang_')) {
        const newLang = data.replace('set_lang_', '');
        try {
          await env.DB.prepare(`
            INSERT INTO users (telegram_id, language_code, first_name, last_name, username)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
              language_code = excluded.language_code,
              updated_at = CURRENT_TIMESTAMP
          `)
            .bind(
              userId,
              newLang,
              cq.from.first_name || '',
              cq.from.last_name || '',
              cq.from.username || ''
            )
            .run();
          await telegram.answerCallbackQuery(cq.id, t(newLang, 'lang_switched'));
          if (cq.message?.chat?.id) {
            await telegram.sendMessage(cq.message.chat.id, t(newLang, 'lang_switched'));
          }
        } catch (error) {
          console.error(`BOT_LANG_CALLBACK_ERROR: ${(error as Error).message}`);
          await telegram.answerCallbackQuery(cq.id);
        }
        return new Response('OK', { status: 200 });
      }
    }

    if (update.my_chat_member) {
      const mcm = update.my_chat_member;
      const chat = mcm.chat;
      const user = mcm.from;
      const isChannel = chat.type === 'channel';
      const isPromoted = mcm.new_chat_member.status === 'administrator';
      const isDemoted = ['left', 'kicked', 'member'].includes(mcm.new_chat_member.status);

      if (isChannel && isPromoted) {
        const countRow = await env.DB.prepare('SELECT COUNT(*) as total FROM channels WHERE telegram_id = ?')
          .bind(user.id)
          .first<{ total: number }>();
        const currentTotal = countRow?.total || 0;
        if (currentTotal < 5) {
          const rawId = String(chat.id);
          const channelIdStr = rawId.startsWith('-100') ? rawId : rawId.startsWith('-') ? `-100${rawId.slice(1)}` : `-100${rawId}`;
          const photoUrl = chat.username ? `https://t.me/i/userpic/320/${chat.username}.jpg` : null;
          await env.DB.prepare(`
            INSERT INTO channels (id, telegram_id, title, username, photo_url)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              telegram_id = excluded.telegram_id,
              title = excluded.title,
              username = excluded.username,
              photo_url = excluded.photo_url
          `)
            .bind(channelIdStr, user.id, chat.title || 'Untitled Channel', chat.username || null, photoUrl)
            .run();
          console.log(`CHANNEL_LINKED_SUCCESS: channel=${channelIdStr}, user=${user.id}`);
        } else {
          console.warn(`CHANNEL_LIMIT_REACHED: user=${user.id}`);
        }
      } else if (isChannel && isDemoted) {
        const rawId = String(chat.id);
        const channelIdStr = rawId.startsWith('-100') ? rawId : rawId.startsWith('-') ? `-100${rawId.slice(1)}` : `-100${rawId}`;
        await env.DB.prepare('DELETE FROM channels WHERE id = ? OR id = ?')
          .bind(channelIdStr, rawId)
          .run();
        console.log(`CHANNEL_UNLINKED: channel=${chat.id}`);
      }
      return new Response('OK', { status: 200 });
    }
  } catch (error) {
    console.error(`BOT_HANDLER_ERROR: ${(error as Error).message}`);
  }
  return new Response('OK', { status: 200 });
}