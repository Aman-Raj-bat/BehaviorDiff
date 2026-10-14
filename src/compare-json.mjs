const MISSING = Symbol('missing');

export function assertJsonPointer(pointer) {
  if (typeof pointer !== 'string' || pointer.length === 0 || !pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: ${JSON.stringify(pointer)}`);
  }

  for (let index = 1; index < pointer.length; index += 1) {
    if (pointer[index] !== '~') continue;
    const escape = pointer[index + 1];
    if (escape !== '0' && escape !== '1') {
      throw new Error(`Invalid JSON Pointer escape in ${JSON.stringify(pointer)}`);
    }
    index += 1;
  }
}

export function decodeJsonPointer(pointer) {
  assertJsonPointer(pointer);
  return pointer
    .slice(1)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function encodePointerPart(part) {
  return String(part).replaceAll('~', '~0').replaceAll('/', '~1');
}

