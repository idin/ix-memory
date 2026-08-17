/**
 * How long a name is allowed to be, and why.
 *
 * Two derivations used to carry their own limit and neither measured the same
 * thing. `subjectToSlug` threw at 96 characters of slug; `subjectSlug` in
 * messages silently sliced at 48. Four message files in the memory repo carry
 * slugs cut to exactly 48 characters, mid-word — the truncation is invisible
 * at the call site, so nobody learned it had happened.
 *
 * Both are wrong in the same way: the limit that matters applies to the whole
 * filename, and a message filename spends roughly 32 characters on a timestamp
 * and sender before the subject gets a look in. Measuring only the slug means
 * the real budget is whatever is left, which nothing checks.
 */

/**
 * The limit being respected.
 *
 * Windows caps a full path at 260 characters. This is not a round number
 * chosen for tidiness — it is that limit, minus the room a repository-relative
 * path needs underneath a clone directory. A clone at
 * `C:\Users\<name>\code\keep` costs roughly 25 characters, and the deepest
 * path inside the namespace, `other-memory/messages/archive/<agent>/`, costs
 * roughly 45 more.
 *
 * That leaves 190 for the filename itself. Rounded down to 180 so a slightly
 * deeper clone or a longer agent name does not push a valid name over the
 * edge on a machine nobody tested on.
 */
export const MAXIMUM_FILENAME_LENGTH = 180;

/**
 * Refuse a filename that is too long, rather than shortening it.
 *
 * The caller is told, and shortens it deliberately. The code never makes that
 * choice: a name trimmed to fit looks like a name somebody chose, and the
 * person who would have shortened it differently never finds out.
 *
 * @param filename - The complete filename, extension included.
 * @param context - What the caller was doing, so the error says which name to
 *   shorten rather than only that some name was too long.
 * @returns The filename unchanged, when it fits.
 * @throws Error naming the length, the limit, and what to do about it.
 */
export function assertFilenameFits(filename: string, context: string): string {
  if (filename.length > MAXIMUM_FILENAME_LENGTH) {
    throw new Error(
      `${context} produces a filename of ${filename.length} characters, over `
        + `the ${MAXIMUM_FILENAME_LENGTH} allowed. Shorten it and try again — `
        + "it is not truncated for you, because a name cut to fit looks like a "
        + "name somebody chose.\n\n"
        + `The name was: ${filename}`,
    );
  }
  return filename;
}
