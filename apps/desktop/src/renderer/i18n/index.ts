import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './ar.json';
import en from './en.json';

export type AppLanguage = 'ar' | 'en';

export function initI18n(initial: AppLanguage = 'ar'): void {
  void i18n.use(initReactI18next).init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    lng: initial,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  applyDir(initial);
}

export function setLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  applyDir(lang);
}

function applyDir(lang: AppLanguage): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
