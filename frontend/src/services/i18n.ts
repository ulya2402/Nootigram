import en from '../locales/en.json';
import id from '../locales/id.json';

const translations: Record<string, Record<string, string>> = {
  en,
  id,
};

type LangListener = (lang: string) => void;
const listeners: Set<LangListener> = new Set();

let currentLanguage = localStorage.getItem('notigram_lang') || 'en';

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