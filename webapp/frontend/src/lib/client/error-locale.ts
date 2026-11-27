/** Read the existing language preference without coupling transport to React. */
export function errorLocale(): 'zh' | 'en' {
  try { return typeof window !== 'undefined' && window.localStorage.getItem('locale') === 'en' ? 'en' : 'zh' }
  catch { return 'zh' }
}
