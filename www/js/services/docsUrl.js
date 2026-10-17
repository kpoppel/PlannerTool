export function getDocsUrl(file, apiBase) {
  if (import.meta.env.DEV === true || window.IS_VITE_DEV === true) return `/docs/${file}`;
  const appBase = apiBase === undefined
    ? window.APP_BASE_URL
    : apiBase.replace(/\/api$/, '');
  if (appBase === undefined) throw new Error('Application base URL is not initialized.');
  return `${appBase}/static/docs/${file}`;
}