import { InputRichMessage } from '../types';

export interface TelegramSendResult {
  ok: boolean;
  errorCode?: number;
  description?: string;
}

let cachedBotUsername = '';

export class TelegramService {
  private readonly baseUrl: string;

  constructor(private readonly token: string) {
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async getBotUsername(): Promise<string> {
    if (cachedBotUsername) return cachedBotUsername;
    try {
      const response = await fetch(`${this.baseUrl}/getMe`);
      const data = (await response.json()) as { ok: boolean; result?: { username?: string } };
      if (data.ok && data.result?.username) {
        cachedBotUsername = data.result.username;
        return cachedBotUsername;
      }
    } catch (error) {
      console.error(`TELEGRAM_GET_ME_FAILED: ${(error as Error).message}`);
    }
    return '';
  }

  async sendMessage(
    chatId: number | string,
    text: string,
    replyMarkup?: Record<string, unknown>,
    parseMode?: string
  ): Promise<TelegramSendResult> {
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
      const data = (await response.json()) as { ok: boolean; error_code?: number; description?: string };
      if (!data.ok) {
        console.error(`TELEGRAM_API_ERROR sendMessage: code=${data.error_code} desc=${data.description}`);
      }
      return { ok: data.ok, errorCode: data.error_code, description: data.description };
    } catch (error) {
      console.error(`TELEGRAM_FETCH_FAILED sendMessage: ${(error as Error).message}`);
      return { ok: false, description: (error as Error).message };
    }
  }

  private formatInlineHtml(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/<div><br\s*[\/]?>\s*<\/div>/gi, '<br>')
      .replace(/<div>/gi, '<br>')
      .replace(/<\/div>/gi, '')
      .replace(/<p>/gi, '')
      .replace(/<\/p>/gi, '<br>')
      .replace(/\r\n|\r|\n/g, '<br>')
      .replace(/&nbsp;/gi, ' ')
      .replace(/<strong>/gi, '<b>')
      .replace(/<\/strong>/gi, '</b>')
      .replace(/<em>/gi, '<i>')
      .replace(/<\/em>/gi, '</i>')
      .replace(/<ins>/gi, '<u>')
      .replace(/<\/ins>/gi, '</u>')
      .replace(/<del>/gi, '<s>')
      .replace(/<\/del>/gi, '</s>')
      .replace(/<strike>/gi, '<s>')
      .replace(/<\/strike>/gi, '</s>')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/(<br>\s*)+$/gi, '')
      .trim();
  }

  private buildRichHtml(richMessage: InputRichMessage): string {
    if (richMessage.html) return this.formatInlineHtml(richMessage.html);
    if (!richMessage.blocks) return '';
    let html = '';
    for (const b of richMessage.blocks) {
      if (b.type === 'heading') {
        const size = b.size || 2;
        const text = this.formatInlineHtml(b.text);
        if (text) html += `<h${size}>${text}</h${size}>\n\n`;
      } else if (b.type === 'paragraph') {
        const text = this.formatInlineHtml(b.text);
        if (text) html += `<p>${text}</p>\n\n`;
      } else if (b.type === 'blockquote') {
        const quoteText = b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '';
        const text = this.formatInlineHtml(quoteText);
        const cite = b.credit ? `<cite>${this.formatInlineHtml(b.credit)}</cite>` : '';
        if (text) html += `<blockquote>${text}${cite}</blockquote>\n\n`;
      } else if (b.type === 'expandable_blockquote') {
        const text = this.formatInlineHtml(b.text);
        const cite = b.credit ? `<cite>${this.formatInlineHtml(b.credit)}</cite>` : '';
        if (text) html += `<blockquote expandable>${text}${cite}</blockquote>\n\n`;
      } else if (b.type === 'pullquote') {
        const text = this.formatInlineHtml(b.text);
        const cite = b.credit ? `<cite>${this.formatInlineHtml(b.credit)}</cite>` : '';
        if (text) html += `<aside>${text}${cite}</aside>\n\n`;
      } else if (b.type === 'pre') {
        const langAttr = b.language ? ` class="language-${b.language}"` : '';
        html += `<pre><code${langAttr}>${b.text}</code></pre>\n\n`;
      } else if (b.type === 'mathematical_expression') {
        html += `<tg-math-block>${b.expression}</tg-math-block>\n\n`;
      } else if (b.type === 'divider') {
        html += `<hr/>\n\n`;
      } else if (b.type === 'table') {
        let attrs = '';
        if (b.is_bordered) attrs += ' bordered';
        if (b.is_striped) attrs += ' striped';
        if (b.is_compact) attrs += ' compact';
        let tbl = `<table${attrs}>`;
        if (b.caption) tbl += `<caption>${this.formatInlineHtml(b.caption)}</caption>`;
        for (let rIdx = 0; rIdx < b.cells.length; rIdx++) {
          tbl += '<tr>';
          for (const cell of b.cells[rIdx]) {
            const tag = cell.is_header || rIdx === 0 ? 'th' : 'td';
            const align = cell.align ? ` align="${cell.align}"` : '';
            tbl += `<${tag}${align}>${this.formatInlineHtml(cell.text)}</${tag}>`;
          }
          tbl += '</tr>';
        }
        tbl += '</table>\n\n';
        html += tbl;
      } else if (b.type === 'list') {
        const isTask = b.items.some((i) => i.has_checkbox);
        const isOrdered = b.items.some((i) => Boolean(i.label));
        if (isTask) {
          html += '<ul>';
          for (const it of b.items) {
            const itText = it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '';
            const chk = it.is_checked ? ' checked' : '';
            html += `<li><input type="checkbox"${chk}>${this.formatInlineHtml(itText)}</li>`;
          }
          html += '</ul>\n\n';
        } else if (isOrdered) {
          html += '<ol>';
          for (const it of b.items) {
            const itText = it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '';
            html += `<li>${this.formatInlineHtml(itText)}</li>`;
          }
          html += '</ol>\n\n';
        } else {
          html += '<ul>';
          for (const it of b.items) {
            const itText = it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '';
            html += `<li>${this.formatInlineHtml(itText)}</li>`;
          }
          html += '</ul>\n\n';
        }
      } else if (b.type === 'details') {
        const detText = b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '';
        html += `<details><summary>${this.formatInlineHtml(b.summary)}</summary>${this.formatInlineHtml(detText)}</details>\n\n`;
      }
    }
    return html.trim();
  }

  async sendRichMessage(chatId: number | string, richMessage: InputRichMessage): Promise<TelegramSendResult> {
    const richHtml = this.buildRichHtml(richMessage);
    try {
      const response = await fetch(`${this.baseUrl}/sendRichMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          rich_message: {
            html: richHtml,
          },
        }),
      });
      const data = (await response.json()) as { ok: boolean; error_code?: number; description?: string };
      if (data.ok) {
        return { ok: true };
      }
      if (data.error_code === 403) {
        console.error(`TELEGRAM_PERMISSION_DENIED: User ${chatId} has not initiated conversation with bot`);
        return { ok: false, errorCode: 403, description: data.description };
      }
      console.error(`TELEGRAM_RICH_MESSAGE_FAILED: ${data.description}, falling back to html sendMessage`);
      return this.sendFallbackHtml(chatId, richHtml);
    } catch (error) {
      console.error(`TELEGRAM_RICH_MESSAGE_EXCEPTION: ${(error as Error).message}`);
      return this.sendFallbackHtml(chatId, richHtml);
    }
  }

  private async sendFallbackHtml(chatId: number | string, html: string): Promise<TelegramSendResult> {
    const adaptedHtml = html
      .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
        const rows = content.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [];
        const lines = rows.map((r: string) => {
          const cells = r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
          return cells.map((c: string) => c.replace(/<[^>]*>/g, '').trim()).join(' | ');
        });
        return `<pre>${lines.join('\n')}</pre>\n\n`;
      })
      .replace(/<details><summary>(.*?)<\/summary>([\s\S]*?)<\/details>/gi, '<b>$1</b>\n<blockquote>$2</blockquote>\n\n')
      .replace(/<aside>(.*?)<\/aside>/gi, '<blockquote>$1</blockquote>\n\n')
      .replace(/<tg-math-block>(.*?)<\/tg-math-block>/gi, '<pre><code>$1</code></pre>\n\n')
      .replace(/<hr\s*[\/]?>/gi, '— — —\n\n')
      .replace(/<li><input type="checkbox" checked>(.*?)<\/li>/gi, '☑ $1\n')
      .replace(/<li><input type="checkbox">(.*?)<\/li>/gi, '☐ $1\n')
      .replace(/<li>(.*?)<\/li>/gi, '• $1\n')
      .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi, '')
      .replace(/<h[1-6]>(.*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n')
      .replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
      .trim();
    const finalHtml = adaptedHtml || 'Empty note';
    const res = await this.sendMessage(chatId, finalHtml, undefined, 'HTML');
    if (!res.ok && res.errorCode === 400) {
      console.error(`TELEGRAM_HTML_REJECTED: ${res.description}, falling back to plain text`);
      const plainText = finalHtml.replace(/<[^>]*>/g, '');
      return this.sendMessage(chatId, plainText);
    }
    return res;
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