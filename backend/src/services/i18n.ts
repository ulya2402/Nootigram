import en from '../locales/en.json';
import id from '../locales/id.json';

const dictionaries: Record<string, Record<string, string>> = {
  en,
  id,
};

export function t(locale: string, key: string, params: Record<string, string> = {}): string {
  const selectedLang = dictionaries[locale] ? locale : 'en';
  let message = dictionaries[selectedLang][key] || dictionaries['en'][key] || key;
  for (const paramKey in params) {
    message = message.replace(new RegExp(`%${paramKey}%`, 'g'), params[paramKey]);
  }
  return message;
}