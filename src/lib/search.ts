import { db } from "@/lib/db";
import { pages, posts } from "@/lib/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { ilike } from "@/lib/db/sql";
import type { SearchPost } from "@/components/frontend/SearchResults";
import { isLive } from "@/lib/publishState";

/**
 * Pages whose title or SEO title/description holds every word of the query (a
 * trailing "s" dropped, so "margarita" finds "Margaritas"). Search covered posts
 * only, so "happy hour" found nothing on a site with a Happy Hour page.
 * Titles and descriptions only: page bodies are block JSON and no index serves them.
 */
export async function searchPagesTop(query: string, language: string) {
  const words = query.trim().slice(0, MAX_QUERY).toLowerCase().split(/\s+/).filter((w) => [...w].length >= 3).slice(0, 5);
  if (!words.length) return [];
  const hits = words.map((w) => {
    const like = likePattern(w.length > 4 ? w.replace(/s$/, "") : w);
    return or(ilike(pages.title, like), ilike(pages.seoTitle, like), ilike(pages.seoDescription, like));
  });
  return db
    .select({ id: pages.id, title: pages.title, slug: pages.slug, language: pages.language, seoDescription: pages.seoDescription })
    .from(pages)
    .where(and(isLive(pages), eq(pages.language, language), ...hits))
    .limit(5);
}

/** Results per page of the search archive. */
export const SEARCH_PER_PAGE = 24;
/**
 * The most matches ever counted or paged through — ten pages. Nobody reads
 * page eleven of site search, and every id past this is a longer scan for
 * nothing; the count then reads "240+" rather than a number we never checked.
 */
const MAX_MATCHES = SEARCH_PER_PAGE * 10;

/**
 * A visitor's words as an FTS5 query: every word required, each as a prefix.
 *
 * FTS5 gives meaning to + - < > ( ) ~ * " @ : ^ { }, so those are removed
 * from what a visitor typed rather than passed through as operators, and each
 * word is quoted. Words under 3 letters are left to the substring pass, as
 * they were on MariaDB. Returns "" when nothing indexable is left.
 */
function booleanQuery(q: string): string {
  const words = q
    .replace(/[+\-<>()~*"@:^{}]/g, " ")
    .split(/\s+/)
    .filter((w) => [...w].length >= 3)
    .slice(0, 10);
  return words.map((w) => `"${w}"*`).join(" ");
}

/**
 * The longest query worth running.
 *
 * `q` arrives straight from the query string with nothing between it and the
 * database, and the substring pass below scans the full body text of every
 * post in the language. A caller is not owed an unbounded pattern.
 */
const MAX_QUERY = 120;

/**
 * A visitor's words as a LIKE pattern, with the pattern language escaped out.
 *
 * `%` and `_` are wildcards, so without this a search for "100%" matched every
 * post and "snake_case" matched "snakeXcase". Worse, a query of alternating
 * `%_%_%_…` makes the matcher backtrack across every article body on the site,
 * which is a slow page anyone can ask for. Backslash is escaped first, or it
 * would escape the escapes.
 */
function likePattern(value: string): string {
  // D1 rejects a LIKE pattern over 50 bytes ("LIKE or GLOB pattern too complex"), so a long
  // admin search 500'd. A shorter substring still finds every row the long one would.
  const make = (v: string) => `%${v.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  let v = value;
  while (v && new TextEncoder().encode(make(v)).length > 50) v = v.slice(0, -1);
  return make(v);
}

/**
 * Whether the FULLTEXT index exists.
 *
 * Assumed true, disproved once. See the catch below.
 */
let fullTextAvailable = true;

/**
 * Searches published posts across title, excerpt and body.
 *
 * Body text lives in `search_text` (flattened from the BlockNote JSON on save)
 * and is covered, with title and excerpt, by the FULLTEXT index
 * `posts_search_ft`, so this stays fast as the archive grows. Those columns
 * compare without case or accents (utf8mb4_uca1400_ai_ci), so Arabic with or
 * without harakat matches. Full-text only matches whole words, so a
 * substring pass runs as a fallback for partial terms like "conten".
 *
 * Scoped to one language, like every other listing: searching from a French
 * page returned English posts, which is content the reader cannot use and which
 * partitioning is supposed to keep apart.
 */
export { likePattern, MAX_QUERY };

/** A query the substring fallback is for: at most two words, none very long. */
function substringWorthTrying(q: string): boolean {
  const words = q.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 2 && q.length <= 40 && words.every((w) => w.length <= 25);
}

/** Searches one visitor may run per minute (see the search page). */
export const SEARCH_RATE = { max: 20, windowMs: 60_000 };

export async function searchPosts(query: string, language: string): Promise<SearchPost[]> {
  return (await searchPostsPage(query, language, 1)).posts;
}

export interface SearchPage {
  posts: SearchPost[];
  /** Matches found, up to MAX_MATCHES. */
  total: number;
  /** True when there were more than `total` — the count is then a floor. */
  capped: boolean;
  totalPages: number;
}

const CARD_COLUMNS = { id: true, title: true, slug: true, excerpt: true, featuredImage: true, publishedAt: true, createdAt: true, language: true } as const;

/**
 * One page of results, in relevance order.
 *
 * The matching ids are found once, ranked, and only the page's own rows are
 * loaded — so page 3 costs one id scan and 24 card rows, not 72.
 */
export async function searchPostsPage(query: string, language: string, page: number): Promise<SearchPage> {
  const q = query.trim().slice(0, MAX_QUERY);
  const empty: SearchPage = { posts: [], total: 0, capped: false, totalPages: 0 };
  if (!q) return empty;

  const ids = await matchIds(q, language);
  if (ids.length === 0) return empty;
  const capped = ids.length > MAX_MATCHES;
  const all = capped ? ids.slice(0, MAX_MATCHES) : ids;
  const totalPages = Math.ceil(all.length / SEARCH_PER_PAGE);
  const n = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const pageIds = all.slice((n - 1) * SEARCH_PER_PAGE, n * SEARCH_PER_PAGE);

  const rows = await db.query.posts.findMany({
    where: (p, { inArray }) => inArray(p.id, pageIds),
    with: { category: true },
    // SearchPost carries card fields only; `content` would be dead weight.
    columns: CARD_COLUMNS,
  });
  // Preserve relevance order, which the second query loses.
  const order = new Map(pageIds.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { posts: rows as unknown as SearchPost[], total: all.length, capped, totalPages };
}

/** Every matching id, best first, up to one past MAX_MATCHES. */
async function matchIds(q: string, language: string): Promise<number[]> {
  const LIMIT = MAX_MATCHES + 1;
  // The substring pass still runs when full-text returns nothing, so a
  // partial term like "conten" keeps working.
  const boolean = booleanQuery(q);
  let ids: number[] = [];
  if (fullTextAvailable && boolean) {
    // posts_fts is the FTS5 index over title, excerpt and search_text
    // (drizzle-d1/0000_baseline.sql); bm25() is lower for a better match.
    try {
      const ranked = await db
        .select({ id: posts.id })
        .from(posts)
        .innerJoin(sql`posts_fts`, sql`posts_fts.rowid = ${posts.id}`)
        .where(and(isLive(posts), eq(posts.language, language), sql`posts_fts MATCH ${boolean}`))
        .orderBy(sql`bm25(posts_fts)`, desc(posts.publishedAt))
        .limit(LIMIT);
      ids = ranked.map((r) => r.id);
    } catch (err) {
      // posts_fts comes from the baseline migration. Where it is missing the
      // query throws and would take the whole search page down with a 500 —
      // though the substring pass below would have answered. Only a missing
      // table disables the attempt for the life of the isolate; a timeout is
      // not a reason to lose ranked search.
      if (/no such table: posts_fts/i.test(String((err as Error)?.message ?? ""))) fullTextAvailable = false;
      console.warn("[search] full-text unavailable, falling back to substring:", (err as Error).message);
    }
  }

  if (ids.length > 0) return ids;

  // The substring pass reads the full text of every live article in the
  // language — no index can serve `%…%` — so it costs a whole-table scan in
  // CPU and database compute. It exists for a partial word ("conten"); a
  // long or many-word query that full-text did not match is almost always a
  // bot's random string, and each one was a free table scan. Only short,
  // few-word queries get it.
  if (!substringWorthTrying(q)) return [];

  // Nothing matched whole-word — try a substring pass so partial terms still work.
  const like = likePattern(q);
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        isLive(posts),
        eq(posts.language, language),
        or(ilike(posts.title, like), ilike(posts.excerpt, like), ilike(posts.searchText, like))
      )
    )
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(LIMIT);
  return rows.map((r) => r.id);
}
