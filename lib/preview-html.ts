export function applyPreviewNonce(html: string | undefined, nonce: string | undefined) {
  if (!html || !nonce) return html;
  return html
    .replace(/(script-src 'nonce-)[^']+(')/, (_match, start: string, end: string) => `${start}${nonce}${end}`)
    .replace(/(style-src 'nonce-)[^']+(')/, (_match, start: string, end: string) => `${start}${nonce}${end}`)
    .replace(/(<style nonce=")[^"]+(")/, (_match, start: string, end: string) => `${start}${nonce}${end}`)
    .replace(/(<script nonce=")[^"]+(")/g, (_match, start: string, end: string) => `${start}${nonce}${end}`);
}
