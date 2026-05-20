/**
 * Re-export rather than redirect so `/factsheet/[id]` stays stable for
 * external bookmarks and shared links. The implementation lives in `./v2/`.
 */
export { default, generateMetadata } from "./v2/page";
