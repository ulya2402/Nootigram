import en from '../locales/en.json';
import id from '../locales/id.json';

const translations: Record<string, Record<string, string>> = {
  en,
  id,
};

let currentLanguage = 'id';

export function setLanguage(lang: string): void {
  currentLanguage = translations[lang] ? lang : 'id';
}

export function getLanguage(): string {
  return currentLanguage;
}

export function t(key: string, params: Record<string, string | number> = {}): string {
  let text = translations[currentLanguage]?.[key] || translations['id']?.[key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`%${k}%`, 'g'), String(v));
  }
  return text;
}