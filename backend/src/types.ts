export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBAPP_URL: string;
  ENVIRONMENT?: string;
  IMGBB_API_KEYS?: string;
  ADMIN_IDS?: string;
}

  export type InputRichBlock =
  | { type: 'heading'; text: string; size: 1 | 2 | 3 | 4 | 5 | 6; id?: string }
  | { type: 'paragraph'; text: string }
  | { type: 'pre'; text: string; language?: string }
  | { type: 'divider' }
  | { type: 'mathematical_expression'; expression: string }
  | { type: 'blockquote'; blocks: InputRichBlock[]; credit?: string }
  | { type: 'expandable_blockquote'; text: string; credit?: string }
  | { type: 'pullquote'; text: string; credit?: string }
  | { 
      type: 'table'; 
      cells: { text: string; is_header?: boolean; align?: 'left' | 'center' | 'right' }[][]; 
      is_bordered?: boolean; 
      is_striped?: boolean;
      is_compact?: boolean;
      caption?: string;
    }
  | {
       type: 'list';
       items: { label?: string; blocks: InputRichBlock[]; has_checkbox?: boolean; is_checked?: boolean }[];
     }
  | { type: 'details'; summary: string; blocks: InputRichBlock[]; is_open?: boolean }
  | {
       type: 'media';
       layout?: 'single' | 'collage' | 'slideshow';
       images: string[];
       caption?: string;
     }
  | {
       type: 'audio';
       url: string;
       caption?: string;
     }
  | {
       type: 'document';
       url: string;
       caption?: string;
     }
  | {
       type: 'button_row';
       align?: 'left' | 'center' | 'right';
       buttons: {
         text: string;
         style?: 'primary' | 'success' | 'danger' | 'link';
         type: 'url' | 'copy_text';
         url?: string;
         copy_text?: string;
       }[];
     }
  | {
       type: 'footer';
       text: string;
     };

export interface InputRichMessage {
  blocks?: InputRichBlock[];
  html?: string;
  markdown?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: { id: number; type: string };
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface ChannelItem {
  id: string;
  telegram_id: number;
  title: string;
  username?: string;
  photo_url?: string;
  created_at?: string;
}

export interface TelegramChatMemberUpdated {
  chat: {
    id: number;
    title: string;
    username?: string;
    type: string;
  };
  from: TelegramUser;
  date: number;
  old_chat_member: { status: string };
  new_chat_member: { status: string };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
  my_chat_member?: TelegramChatMemberUpdated;
}

export interface NotePayload {
  id: string;
  category: string;
  title: string;
  content_raw: string;
  blocks: InputRichBlock[];
  is_pinned: boolean;
}

export interface TopicPayload {
  id: string;
  name: string;
  is_default?: boolean;
}