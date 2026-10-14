export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function joinPointer(base, token) {
  const escaped = escapePointerToken(token);
  return base === '/' ? `/${escaped}` : `${base === '' ? '' : base}/${escaped}`;
}
