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

function pointerFor(parent, part) {
  return `${parent}/${encodePointerPart(part)}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function comparableValue(value) {
  return value === MISSING ? { $missing: true } : value;
}

function collectDifferences(reference, candidate, pointer, ignored, differences, ignoredDifferences) {
  if (ignored.has(pointer)) {
    const nestedDifferences = [];
    collectDifferences(reference, candidate, pointer, new Set(), nestedDifferences, []);
    ignoredDifferences.push(...nestedDifferences.map((difference) => ({
      pointer: difference.pointer,
      reference: difference.reference,
      candidate: difference.candidate,
    })));
    return;
  }

  if (reference === MISSING || candidate === MISSING) {
    differences.push({
      pointer,
      reference: comparableValue(reference),
      candidate: comparableValue(candidate),
    });
    return;
  }

  if (Object.is(reference, candidate)) return;

  if (Array.isArray(reference) && Array.isArray(candidate)) {
    const length = Math.max(reference.length, candidate.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(
        index < reference.length ? reference[index] : MISSING,
        index < candidate.length ? candidate[index] : MISSING,
        pointerFor(pointer, index),
        ignored,
        differences,
        ignoredDifferences,
      );
    }
    return;
  }

  if (isObject(reference) && isObject(candidate)) {
    const keys = new Set([...Object.keys(reference), ...Object.keys(candidate)]);
    for (const key of [...keys].sort()) {
      collectDifferences(
        Object.hasOwn(reference, key) ? reference[key] : MISSING,
        Object.hasOwn(candidate, key) ? candidate[key] : MISSING,
        pointerFor(pointer, key),
        ignored,
        differences,
        ignoredDifferences,
      );
    }
    return;
  }

  differences.push({
    pointer,
    reference,
    candidate,
  });
}

export function compareJson(reference, candidate, ignorePaths = []) {
  for (const pointer of ignorePaths) assertJsonPointer(pointer);

  const differences = [];

  return [];
}
