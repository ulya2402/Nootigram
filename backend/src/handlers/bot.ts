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
        const preferredLang = message.from.language_code?.startsWith('id') ? 'id' : 'en';
        await env.DB.prepare(
          'INSERT INTO users (telegram_id, language_code, first_name, last_name, username) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(
            userId,
            preferredLang,
            message.from.first_name || '',
            message.from.last_name || null,
            message.from.username || null
          )
          .run();
        user = { telegram_id: userId, language_code: preferredLang };
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
        await env.DB.prepare('UPDATE users SET language_code = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?')
          .bind(newLang, userId)
          .run();

        await telegram.answerCallbackQuery(cq.id, t(newLang, 'lang_switched'));
        if (cq.message) {
          await telegram.sendMessage(cq.message.chat.id, t(newLang, 'lang_switched'));
        }
        return new Response('OK', { status: 200 });
      }
    }
  } catch (error) {
    console.error(`BOT_HANDLER_ERROR: ${(error as Error).message}`);
  }

  return new Response('OK', { status: 200 });
}