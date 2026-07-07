// ── Document language tag (BCP-47) ─────────────────────────────────
//
// Maps an app locale to the language tag written to the document `<html lang>`.
// The browser's spell-/grammar-checker chooses its dictionary from the nearest
// ancestor `lang` — which for every <input>, <textarea> and contenteditable is
// the root <html>. Emitting the correct tag here makes typed content in ALL form
// controls be checked in the right language (they inherit it), instead of the
// browser UI language (usually English).
//
// CHMS is French-first, so an unknown or absent locale falls back to Senegal
// French (fr-SN) — never English. English is emitted only when the app locale is
// explicitly English.

export type AppLocale = 'fr' | 'en'

// Region-qualified so the dictionary match is precise; browsers fall back to the
// base French dictionary for the region variant.
const HTML_LANG: Record<AppLocale, string> = {
  fr: 'fr-SN', // French as used in Senegal (the CHMS default)
  en: 'en',
}

/** The BCP-47 tag for `<html lang>` given the app locale. French-first default. */
export function localeToHtmlLang(locale?: string | null): string {
  return locale != null && locale in HTML_LANG ? HTML_LANG[locale as AppLocale] : HTML_LANG.fr
}
