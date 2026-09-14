import { InputRichMessage } from '../types';

export class TelegramService {
  private readonly baseUrl: string;

  constructor(private readonly token: string) {
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async sendMessage(chatId: number | string, text: string, replyMarkup?: Record<string, unknown>, parseMode?: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          reply_markup: replyMarkup,
        }),
      });
      const data = (await response.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        console.error(`TELEGRAM_API_ERROR sendMessage: ${data.description}`);
      }
      return data.ok;
    } catch (error) {
      console.error(`TELEGRAM_FETCH_FAILED sendMessage: ${(error as Error).message}`);
      return false;
    }
  }

  async sendRichMessage(chatId: number | string, richMessage: InputRichMessage): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/sendRichMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          rich_message: richMessage,
        }),
      });
      const data = (await response.json()) as { ok: boolean; description?: string };
      if (data.ok) {
        return true;
      }

      console.error(`TELEGRAM_RICH_MESSAGE_FAILED: ${data.description}, falling back to standard message`);
      return this.sendFallbackMarkdown(chatId, richMessage);
    } catch (error) {
      console.error(`TELEGRAM_RICH_MESSAGE_EXCEPTION: ${(error as Error).message}`);
      return this.sendFallbackMarkdown(chatId, richMessage);
    }
  }

  private async sendFallbackMarkdown(chatId: number | string, richMessage: InputRichMessage): Promise<boolean> {
    let md = '';
    if (richMessage.markdown) {
      md = richMessage.markdown;
    } else if (richMessage.blocks) {
      for (const b of richMessage.blocks) {
        if (b.type === 'heading') {
          md += `*${b.text}*\n\n`;
        } else if (b.type === 'paragraph') {
          md += `${b.text}\n\n`;
        } else if (b.type === 'blockquote') {
          const quoteText = b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '';
          md += `>${quoteText}\n\n`;
        } else if (b.type === 'expandable_blockquote') {
          md += `**>${b.text}**\n\n`;
        } else if (b.type === 'pullquote') {
          md += `_${b.text}_\n\n`;
        } else if (b.type === 'pre') {
          md += `\`\`\`${b.language || ''}\n${b.text}\n\`\`\`\n\n`;
        } else if (b.type === 'mathematical_expression') {
          md += `$$${b.expression}$$\n\n`;
        } else if (b.type === 'divider') {
          md += `---\n\n`;
        } else if (b.type === 'table') {
          for (const row of b.cells) {
            md += `| ${row.map((c) => c.text).join(' | ')} |\n`;
          }
          md += '\n';
        } else if (b.type === 'list') {
          for (const item of b.items) {
            const itemText = item.blocks && item.blocks[0] && 'text' in item.blocks[0] ? (item.blocks[0] as any).text : '';
            md += `${item.has_checkbox ? (item.is_checked ? '☑ ' : '☐ ') : '• '}${itemText}\n`;
          }
          md += '\n';
        } else if (b.type === 'details') {
          const detText = b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '';
          md += `*${b.summary}*\n${detText}\n\n`;
        }
      }
    }

    if (!md.trim()) {
      md = 'Empty note';
    }

    return this.sendMessage(chatId, md, undefined, 'Markdown');
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
        }),
      });
      const data = (await response.json()) as { ok: boolean };
      return data.ok;
    } catch (error) {
      console.error(`TELEGRAM_FETCH_FAILED answerCallbackQuery: ${(error as Error).message}`);
      return false;
    }
  }

  async validateInitData(initData: string): Promise<Record<string, unknown> | null> {
    try {
      if (!initData) return null;
      const params = new URLSearchParams(initData);
      const hash = params.get('hash');
      if (!hash) return null;

      params.delete('hash');
      const keys = Array.from(params.keys()).sort();
      const checkString = keys.map((key) => `${key}=${params.get(key)}`).join('\n');

      const encoder = new TextEncoder();
      const secretKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const secretHmac = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(this.token));
      const keyForValidation = await crypto.subtle.importKey(
        'raw',
        secretHmac,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const validationHmac = await crypto.subtle.sign('HMAC', keyForValidation, encoder.encode(checkString));
      const expectedHash = Array.from(new Uint8Array(validationHmac))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

      if (expectedHash !== hash) {
        console.error('TELEGRAM_AUTH_VALIDATION_FAILED: Hash mismatch');
        return null;
      }

      const userJson = params.get('user');
      if (!userJson) return null;

      return JSON.parse(userJson) as Record<string, unknown>;
    } catch (error) {
      console.error(`TELEGRAM_AUTH_EXCEPTION: ${(error as Error).message}`);
      return null;
    }
  }
}