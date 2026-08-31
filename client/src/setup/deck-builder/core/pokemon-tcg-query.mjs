function escapeLucenePhrase(value = '') {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildPokemonTcgQuery(cleanName = '') {
  const value = String(cleanName).trim();
  if (!value) return '';

  const requiresPhrase =
    /\s/.test(value) || /(&&|\|\||[+\-!(){}\u005b\u005d^"~*?:\\/])/.test(value);

  return requiresPhrase
    ? `name:"${escapeLucenePhrase(value)}"`
    : `name:${value}*`;
}
