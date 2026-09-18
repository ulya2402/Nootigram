export interface TableCell {
  text: string;
  is_header?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface TaskItem {
  id: string;
  text: string;
  is_checked: boolean;
}

export interface TopicItem {
  id: string;
  name: string;
  is_default?: boolean;
}

export interface MediaImageItem {
  id: string;
  url: string;
  delete_url?: string;
}

export interface ChannelItem {
  id: string;
  title: string;
  username?: string;
  photo_url?: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export type ContentBlock =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'heading'; size: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { id: string; type: 'quote'; text: string; credit?: string }
  | { id: string; type: 'expandable_quote'; text: string; credit?: string }
  | { id: string; type: 'pullquote'; text: string; credit?: string }
  | { id: string; type: 'list'; style: 'task' | 'bullet' | 'ordered'; items: TaskItem[] }
  | {
      id: string;
      type: 'table';
      cells: TableCell[][];
      is_bordered?: boolean;
      is_striped?: boolean;
      is_compact?: boolean;
      caption?: string;
    }
  | { id: string; type: 'code'; text: string; language?: string }
  | { id: string; type: 'math'; expression: string }
  | { id: string; type: 'details'; summary: string; text: string }
  | { id: string; type: 'divider' }
  | {
      id: string;
      type: 'media';
      layout: 'single' | 'collage' | 'slideshow';
      images: MediaImageItem[];
      caption?: string;
    }
  | {
      id: string;
      type: 'audio';
      url: string;
      name: string;
      size?: number;
      caption?: string;
    }
  | {
      id: string;
      type: 'file';
      url: string;
      name: string;
      size?: number;
      caption?: string;
    }
  | {
      id: string;
      type: 'button_row';
      align: 'left' | 'center' | 'right';
      buttons: {
        id: string;
        text: string;
        style: 'default' | 'primary' | 'success' | 'danger';
        type: 'url' | 'copy_text';
        value: string;
      }[];
    }
  | {
      id: string;
      type: 'footer';
      text: string;
    };

export interface NoteItem {
  id: string;
  category: string;
  title: string;
  content_raw?: string;
  blocks: ContentBlock[];
  is_pinned: boolean;
  is_favorite: boolean;
  updated_at_str: string;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
      photo_url?: string;
    };
  };
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  enableClosingConfirmation: () => void;
  disableVerticalSwipes: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (eventType: string, eventHandler: () => void) => void;
  offEvent: (eventType: string, eventHandler: () => void) => void;
  openTelegramLink: (url: string) => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  requestWriteAccess: (callback?: (allowed: boolean) => void) => void;
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
    offClick: (callback: () => void) => void;
  };
  HapticFeedback: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
    selectionChanged: () => void;
  };
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}