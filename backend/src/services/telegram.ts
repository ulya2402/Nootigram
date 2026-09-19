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

  private escapeText(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private formatInlineHtml(raw: string): string {
    if (!raw) return '';
    let formatted = raw
      .replace(/<span\s+style="[^"]*font-weight:\s*(?:bold|700)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '<b>$1</b>')
      .replace(/<span\s+style="[^"]*font-style:\s*italic[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '<i>$1</i>')
      .replace(/<span\s+style="[^"]*text-decoration:\s*underline[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '<u>$1</u>')
      .replace(/<span\s+style="[^"]*text-decoration:\s*line-through[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '<s>$1</s>')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '$1')
      .replace(/<h[1-6][^>]*>/gi, '')
      .replace(/<\/h[1-6]>/gi, '')
      .replace(/<div><br\s*[\/]?>\s*<\/div>/gi, '\n')
      .replace(/<div>/gi, '\n')
      .replace(/<\/div>/gi, '')
      .replace(/<p>/gi, '')
      .replace(/<\/p>/gi, '\n')
      .replace(/\r\n|\r/g, '\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const tokens = formatted.split(/(<[^>]+>)/g);
    formatted = tokens
      .map((part) => {
        if (!part) return '';
        if (part.startsWith('<') && part.endsWith('>')) {
          if (/^<(?:b|strong)(?:\s+[^>]*)?>$/i.test(part)) return '<b>';
          if (/^<\/(?:b|strong)>$/i.test(part)) return '</b>';
          if (/^<(?:i|em)(?:\s+[^>]*)?>$/i.test(part)) return '<i>';
          if (/^<\/(?:i|em)>$/i.test(part)) return '</i>';
          if (/^<(?:u|ins)(?:\s+[^>]*)?>$/i.test(part)) return '<u>';
          if (/^<\/(?:u|ins)>$/i.test(part)) return '</u>';
          if (/^<(?:s|strike|del)(?:\s+[^>]*)?>$/i.test(part)) return '<s>';
          if (/^<\/(?:s|strike|del)>$/i.test(part)) return '</s>';
          if (/^<code>$/i.test(part)) return '<code>';
          if (/^<\/code>$/i.test(part)) return '</code>';
          if (/^<tg-spoiler>$/i.test(part)) return '<tg-spoiler>';
          if (/^<\/tg-spoiler>$/i.test(part)) return '</tg-spoiler>';
          if (/^<mark>$/i.test(part)) return '<mark>';
          if (/^<\/mark>$/i.test(part)) return '</mark>';
          if (/^<tg-time(?:\s+[^>]*)?>$/i.test(part)) return part;
          if (/^<\/tg-time>$/i.test(part)) return '</tg-time>';
          if (/^<a\s+(?:href="[^"]*"|name="[^"]*")>$/i.test(part)) return part;
          if (/^<\/a>$/i.test(part)) return '</a>';
          return part.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        return part
          .replace(/&(?!((?:lt|gt|amp|quot|apos|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo)|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      })
      .join('');
    const tags = ['b', 'i', 'u', 's', 'code', 'tg-spoiler', 'a', 'tg-time', 'mark'];
    for (const tag of tags) {
      const openCount = (formatted.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi')) || []).length;
      const closeCount = (formatted.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      if (openCount > closeCount) {
        formatted += `</${tag}>`.repeat(openCount - closeCount);
      } else if (closeCount > openCount) {
        let excess = closeCount - openCount;
        formatted = formatted.replace(new RegExp(`</${tag}>`, 'gi'), (match) => {
          if (excess > 0) {
            excess--;
            return '';
          }
          return match;
        });
      }
    }

    return formatted.trim();
  }

  private buildRichHtml(richMessage: InputRichMessage): string {
    if (richMessage.html) return this.formatInlineHtml(richMessage.html);
    if (!richMessage.blocks) return '';

    let html = '';
    for (const b of richMessage.blocks) {
      if (b.type === 'heading') {
        const size = b.size || 2;
        const text = this.escapeText(b.text);
        const headingId = (b as { id?: string }).id;
        const anchorName = headingId ? `chapter-${this.escapeText(headingId)}` : '';
        const anchorTag = anchorName ? `<a name="${anchorName}"></a>` : '';
        if (text) html += `${anchorTag}<h${size}>${text}</h${size}>\n`;
      } else if (b.type === 'paragraph') {
        const text = this.formatInlineHtml(b.text);
        if (text) html += `<p>${text}</p>\n`;
      } else if (b.type === 'blockquote') {
        const quoteText = (b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '') || (b as any).text || '';
        const text = this.formatInlineHtml(quoteText);
        const cite = b.credit ? `<cite>${this.escapeText(b.credit)}</cite>` : '';
        if (text) html += `<blockquote>${text}${cite}</blockquote>\n\n`;
      } else if (b.type === 'expandable_blockquote') {
        const text = this.formatInlineHtml(b.text);
        const cite = b.credit ? `<cite>${this.escapeText(b.credit)}</cite>` : '';
        if (text) html += `<blockquote expandable>${text}${cite}</blockquote>\n\n`;
      } else if (b.type === 'pullquote') {
        const text = this.formatInlineHtml(b.text);
        const cite = b.credit ? `<cite>${this.escapeText(b.credit)}</cite>` : '';
        if (text) html += `<aside>${text}${cite}</aside>\n\n`;
      } else if (b.type === 'pre') {
        const langAttr = b.language ? ` class="language-${this.escapeText(b.language)}"` : '';
        const escapedCode = this.escapeText(b.text || '');
        html += `<pre><code${langAttr}>${escapedCode}</code></pre>\n\n`;
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
            const itText = (it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '') || (it as any).text || '';
            const chk = it.is_checked ? ' checked' : '';
            html += `<li><input type="checkbox"${chk}>${this.escapeText(itText)}</li>`;
          }
          html += '</ul>\n\n';
        } else if (isOrdered) {
          html += '<ol>';
          for (const it of b.items) {
            const itText = (it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '') || (it as any).text || '';
            html += `<li>${this.escapeText(itText)}</li>`;
          }
          html += '</ol>\n\n';
        } else {
          html += '<ul>';
          for (const it of b.items) {
            const itText = (it.blocks && it.blocks[0] && 'text' in it.blocks[0] ? (it.blocks[0] as any).text : '') || (it as any).text || '';
            html += `<li>${this.escapeText(itText)}</li>`;
          }
          html += '</ul>\n\n';
        }
      } else if (b.type === 'details') {
        const detText = (b.blocks && b.blocks[0] && 'text' in b.blocks[0] ? (b.blocks[0] as any).text : '') || (b as any).text || '';
        html += `<details><summary>${this.formatInlineHtml(b.summary)}</summary>${this.formatInlineHtml(detText)}</details>\n\n`;
      } else if (b.type === 'media') {
        const captionText = b.caption ? this.escapeText(b.caption) : '';
        const captionTag = captionText ? `<figcaption>${captionText}</figcaption>` : '';
        if (b.layout === 'slideshow' && b.images.length > 1) {
          const imgs = b.images.map((src) => `<img src="${src}"/>`).join('');
          html += `<tg-slideshow>${imgs}${captionTag}</tg-slideshow>\n\n`;
        } else if (b.layout === 'collage' && b.images.length > 1) {
          const imgs = b.images.map((src) => `<img src="${src}"/>`).join('');
          html += `<tg-collage>${imgs}${captionTag}</tg-collage>\n\n`;
        } else if (b.images.length > 0) {
          if (captionTag) {
            html += `<figure><img src="${b.images[0]}"/>${captionTag}</figure>\n\n`;
          } else {
            html += `<img src="${b.images[0]}"/>\n\n`;
          }
        }
      } else if (b.type === 'audio') {
        const captionText = b.caption ? this.escapeText(b.caption) : '';
        const safeUrl = this.escapeText(b.url);
        if (captionText) {
          html += `<figure><audio src="${safeUrl}"></audio><figcaption>${captionText}</figcaption></figure>\n\n`;
        } else {
          html += `<audio src="${safeUrl}"></audio>\n\n`;
        }
      } else if (b.type === 'document') {
        const captionText = b.caption ? this.escapeText(b.caption) : '';
        const safeUrl = this.escapeText(b.url);
        if (captionText) {
          html += `<figure><tg-document src="${safeUrl}"></tg-document><figcaption>${captionText}</figcaption></figure>\n\n`;
        } else {
          html += `<tg-document src="${safeUrl}"></tg-document>\n\n`;
        }
      } else if (b.type === 'button_row' && Array.isArray(b.buttons) && b.buttons.length > 0) {
        const alignAttr = b.align ? ` align="${b.align}"` : '';
        let rowHtml = `<tg-button-row${alignAttr}>\n`;
        for (const btn of b.buttons) {
          const styleAttr = btn.style ? ` style="${btn.style}"` : '';
          const btnText = this.escapeText(btn.text || 'Button');
          if (btn.type === 'copy_text') {
            const copyAttr = ` text="${this.escapeText(btn.copy_text || '')}"`;
            rowHtml += `  <tg-button type="copy_text"${styleAttr}${copyAttr}>${btnText}</tg-button>\n`;
          } else {
            const urlAttr = ` url="${this.escapeText(btn.url || 'https://t.me')}"`;
            rowHtml += `  <tg-button type="url"${styleAttr}${urlAttr}>${btnText}</tg-button>\n`;
          }
        }
        rowHtml += `</tg-button-row>\n\n`;
        html += rowHtml;
      } else if (b.type === 'footer') {
        const text = this.formatInlineHtml(b.text);
        if (text) html += `<footer>${text}</footer>\n\n`;
      }
    }
    return html.trim();
  }

  async sendRichMessage(chatId: number | string, richMessage: InputRichMessage): Promise<TelegramSendResult> {
    const richHtml = this.buildRichHtml(richMessage);
    console.log(`[TELEGRAM] Calling sendRichMessage endpoint for chatId=${chatId}, htmlLength=${richHtml.length}`);
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
        console.log(`[TELEGRAM] sendRichMessage success for chatId=${chatId}`);
        return { ok: true };
      }
      console.warn(`[TELEGRAM] sendRichMessage failed (code=${data.error_code}, desc=${data.description}), falling back to html sendMessage`);
      if (data.error_code === 403) {
        return { ok: false, errorCode: 403, description: data.description };
      }
      return this.sendFallbackHtml(chatId, richHtml);
    } catch (error) {
      console.error(`[TELEGRAM] sendRichMessage network exception: ${(error as Error).message}`);
      return this.sendFallbackHtml(chatId, richHtml);
    }
  }

  private async sendFallbackHtml(chatId: number | string, html: string): Promise<TelegramSendResult> {
    const adaptedHtml = html
      .replace(/<cite>(.*?)<\/cite>/gi, '<i> — $1</i>')
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
      .replace(/<hr\s*[\/]?>/gi, '—\n\n')
      .replace(/<tg-collage>([\s\S]*?)<\/tg-collage>/gi, '$1\n\n')
      .replace(/<tg-slideshow>([\s\S]*?)<\/tg-slideshow>/gi, '$1\n\n')
      .replace(/<figure>([\s\S]*?)<\/figure>/gi, '$1\n\n')
      .replace(/<figcaption>(.*?)<\/figcaption>/gi, '<i>$1</i>\n')
      .replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '<a href="$1">&#128444; Photo</a>\n')
      .replace(/<audio[^>]*src="([^"]*)"[^>]*><\/audio>/gi, '<a href="$1">&#127925; Audio</a>\n')
      .replace(/<tg-document[^>]*src="([^"]*)"[^>]*><\/tg-document>/gi, '<a href="$1">&#128206; Document</a>\n')
      .replace(/<tg-button-row[^>]*>([\s\S]*?)<\/tg-button-row>/gi, '$1\n')
      .replace(/<tg-button[^>]*type="url"[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/tg-button>/gi, '<a href="$1">&#128279; $2</a> ')
      .replace(/<tg-button[^>]*type="copy_text"[^>]*text="([^"]*)"[^>]*>([\s\S]*?)<\/tg-button>/gi, '&#128203; <b>$2:</b> <code>$1</code> ')
      .replace(/<tg-time[^>]*>([\s\S]*?)<\/tg-time>/gi, '&#128340; $1')
      .replace(/<footer>([\s\S]*?)<\/footer>/gi, '\n— $1\n\n')
      .replace(/<li><input type="checkbox" checked>(.*?)<\/li>/gi, '  $1\n')
      .replace(/<li><input type="checkbox">(.*?)<\/li>/gi, '  $1\n')
      .replace(/<li>(.*?)<\/li>/gi, '  $1\n')
      .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi, '')
      .replace(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n')
      .replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<(?:mark|sub|sup)>([\s\S]*?)<\/(?:mark|sub|sup)>/gi, '$1')
      .replace(/\n{3,}/g, '\n\n')
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

  async leaveChat(chatId: number | string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/leaveChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
        }),
      });
      const data = (await response.json()) as { ok: boolean };
      return data.ok;
    } catch (error) {
      console.error(`TELEGRAM_FETCH_FAILED leaveChat: ${(error as Error).message}`);
      return false;
    }
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