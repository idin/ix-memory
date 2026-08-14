/**
 * Base64 for GitHub's contents API, which returns and accepts file bodies
 * encoded this way.
 *
 * `atob` alone is not enough and looks like it is. It yields one character per
 * byte, so any multi-byte UTF-8 sequence comes back as mojibake — and this
 * store is full of em-dashes and typographic quotes, which are exactly that.
 * The bug is invisible until someone searches for a word next to one.
 *
 * So decoding goes through TextDecoder, and encoding through TextEncoder,
 * rather than treating a byte and a character as the same thing.
 */

/**
 * Decode base64 to text, correctly for non-ASCII content.
 *
 * @param value - Base64, possibly with the line breaks GitHub inserts.
 * @returns The decoded text.
 */
export function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Encode text as base64, correctly for non-ASCII content.
 *
 * @param value - The text to encode.
 * @returns Base64, without line breaks.
 */
export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
