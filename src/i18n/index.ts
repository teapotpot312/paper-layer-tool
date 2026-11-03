import { createContext, useContext } from 'react';
import { en } from './en';
import { zhTW, type Dict } from './zh-TW';

export type Lang = 'zh-TW' | 'en';
export const dicts: Record<Lang, Dict> = { 'zh-TW': zhTW, en };
export type TKey = keyof Dict;

export function makeT(lang: Lang) {
  const d = dicts[lang];
  return (key: TKey, vars?: Record<string, string | number>) => {
    let s: string = d[key] ?? zhTW[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export type T = ReturnType<typeof makeT>;
export const I18nContext = createContext<T>(makeT('zh-TW'));
export const useT = () => useContext(I18nContext);
