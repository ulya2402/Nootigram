import en from '../locales/en.json';
import id from '../locales/id.json';
import ru from '../locales/ru.json';
import fa from '../locales/fa.json';
import hi from '../locales/hi.json';

export interface LanguageItem {
  code: string;
  name: string;
  isRtl?: boolean;
}

export const SUPPORTED_LANGUAGES: LanguageItem[] = [
  { code: 'en', name: 'English' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ru', name: 'Русский' },
  { code: 'fa', name: 'فارسی', isRtl: true },
  { code: 'hi', name: 'हिन्दी' },
];

const translations: Record<string, Record<string, string>> = {
  en,
  id,
  ru,
  fa,
  hi,
};

type LangListener = (lang: string) => void;
const listeners: Set<LangListener> = new Set();
let currentLanguage = localStorage.getItem('notigram_lang') || 'en';

const initialItem = SUPPORTED_LANGUAGES.find((l) => l.code === currentLanguage);
if (typeof document !== 'undefined') {
  document.documentElement.dir = initialItem?.isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLanguage;
}

export function subscribeLanguage(listener: LangListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLanguage(lang: string): void {
  const target = translations[lang] ? lang : 'en';
  currentLanguage = target;
  localStorage.setItem('notigram_lang', target);
  const targetItem = SUPPORTED_LANGUAGES.find((l) => l.code === target);
  if (typeof document !== 'undefined') {
    document.documentElement.dir = targetItem?.isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = target;
  }
  listeners.forEach((fn) => fn(target));
}

export function getLanguage(): string {
  return currentLanguage;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  let text = translations[currentLanguage]?.[key] || translations['en']?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`%${k}%`, 'g'), String(v));
  }
  return text;
}