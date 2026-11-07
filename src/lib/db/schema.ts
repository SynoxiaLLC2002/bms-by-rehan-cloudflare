import { sqliteTable, text, integer, primaryKey, index, uniqueIndex, customType, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Written by the database: milliseconds since 1970 (UTC), the same value
// Drizzle's `timestamp_ms` columns read back as a Date.
const NOW = sql`(cast((julianday('now') - 2440587.5) * 86400000 as integer))`;

/** JSON stored as TEXT and parsed on read, so block documents arrive as objects. */
const jsonText = customType<{ data: unknown; driverData: string }>({
  dataType: () => "text",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => (typeof value === "string" ? JSON.parse(value) : value),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "timestamp_ms" }),
  image: text("image"),
  password: text("password"),
  // Defaults to the least privilege, not the most. The API always sets this
  // explicitly, so the default only applies to a row inserted some other
  // way — a restored backup, a hand-written INSERT — and "admin" meant
  // every one of those silently became an administrator.
  role: text("role").notNull().default("editor"),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).default(false),
  /** Attempts at /api/auth/reset-2fa inside the window below (drizzle/0020). */
  totpResetFailures: integer("totp_reset_failures").notNull().default(0),
  /** Start of the current 24-hour attempt window, or null when there is none. */
  totpResetSince: integer("totp_reset_since", { mode: "timestamp_ms" }),
  lastLogin: integer("last_login", { mode: "timestamp_ms" }),

  // ── The public person, as opposed to the account ──────────────────────────
  //
  // A byline had nowhere to point and nothing behind it. These are what an
  // author page is made of.

  /** URL segment for the author page. Unique among the rows that have one. */
  slug: text("slug"),
  bio: text("bio"),
  website: text("website"),
  twitter: text("twitter"),
  linkedin: text("linkedin"),
  facebook: text("facebook"),
  instagram: text("instagram"),
  github: text("github"),
  youtube: text("youtube"),

  // SEO, named to match posts, pages and categories.
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  canonicalUrl: text("canonical_url"),
  ogImage: text("og_image"),
  noIndex: integer("no_index", { mode: "boolean" }).notNull().default(false),

  /**
   * Whether this account has a public author page.
   *
   * Off by default: most accounts never write anything, and giving every
   * login a public URL by default leaks the staff list before anyone has
   * chosen to have one. Existing accounts keep whatever they already had —
   * this only changes what a newly created account starts as.
   */
  publicProfile: integer("public_profile", { mode: "boolean" }).notNull().default(false),

  // Layout for that page, named to match the equivalents on `pages` so the
  // editor and the renderer can treat every document type the same way. An
  // author page was the only public document with no say over its own width.
  /** "ltr" / "rtl" override for this account's page, or null to follow its language — same field posts and pages already carry. */
  direction: text("direction"),
  /**
   * Language override for the author page's `<html lang>` (and Direction's
   * "Auto" fallback), independent of which `/en`, `/fr`… address it is read
   * under — unlike a post or page, this one document answers at every
   * language's address at once, so it needs its own idea of what language it
   * is written in rather than inheriting the URL's.
   */
  language: text("language"),
  pageLayout: text("page_layout").notNull().default("default"),
  contentStyle: text("content_style").notNull().default("default"),
  verticalSpacing: text("vertical_spacing").notNull().default("default"),
  transparentHeader: text("transparent_header").notNull().default("default"),
  disableHeader: integer("disable_header", { mode: "boolean" }).notNull().default(false),
  disableFooter: integer("disable_footer", { mode: "boolean" }).notNull().default(false),
  cssClasses: text("css_classes"),
  customCss: text("custom_css"),
  scriptHead: text("script_head"),
  scriptBodyEnd: text("script_body_end"),

  /**
   * The author page as an actual block document, the same `content` shape
   * `pages` and `posts` carry. Null until the author opens the page editor for
   * the first time — until then the page renders from the profile fields
   * directly (avatar, bio, social links), which is what a null `content` means
   * to every reader of this column.
   */
  content: jsonText("content"),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  // An author's public page lives at /author/<slug>, so two users sharing a
  // slug would make one of them unreachable. `slug` is null for every account
  // that has never been given an author page; a SQLite UNIQUE index allows
  // any number of NULLs, so no partial index is needed.
  uniqueIndex("users_slug_key").on(t.slug),
]);

// Tokens a program signs in with instead of a browser — the MCP hub, a
// script. See lib/apiTokens.ts and drizzle/0019_api_tokens.sql.
export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** SHA-256 hex of the token. The token itself is never stored. */
  tokenHash: text("token_hash").notNull(),
  /** The first characters, so a list can tell tokens apart. */
  prefix: text("prefix").notNull(),
  /** The most this token may do; the owner's current role still caps it. */
  role: text("role").notNull().default("editor"),
  /** Extra powers beyond the role, comma-separated: "backups", "plugins" (lib/apiTokens.ts). */
  scopes: text("scopes").notNull().default(""),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  uniqueIndex("api_tokens_hash_key").on(t.tokenHash),
  index("api_tokens_user_idx").on(t.userId),
]);

/**
 * "Connect Claude" sign-in codes (lib/oauth.ts): written when the owner clicks
 * Allow, traded once for an API token within five minutes, then deleted.
 */
export const oauthCodes = sqliteTable("oauth_codes", {
  /** SHA-256 hex of the code. */
  codeHash: text("code_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  tokenName: text("token_name").notNull(),
  role: text("role").notNull(),
  scopes: text("scopes").notNull().default(""),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

export const sessions = sqliteTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Unique within a language, not globally — see the composite index below.
  slug: text("slug").notNull(),
  description: text("description"),
  /**
   * Which language set this term belongs to.
   *
   * Posts were partitioned by language while the terms they are filed under
   * were not, so a French archive listed English category names.
   */
  language: text("language").notNull().default("en"),
  /**
   * Writing direction override for the archive: "ltr" or "rtl". Null follows
   * the language, the same rule documents use — see documentDir().
   */
  direction: text("direction"),
  /** Links this term to the same term in another language. */
  translationGroup: integer("translation_group"),

  /**
   * Parent term, for hierarchy.
   *
   * `ON DELETE SET NULL`, not cascade: deleting a parent orphans its children
   * rather than silently deleting a whole subtree — and with it the only route
   * by which those posts were reachable.
   */
  parentId: integer("parent_id"),

  // Archive appearance, overriding the Customizer's archive defaults.
  archiveColor: text("archive_color"),
  archiveHoverColor: text("archive_hover_color"),
  headerImage: text("header_image"),
  /** default | 1 | 2 | 3 | 4 — `default` follows the site-wide setting. */
  archiveColumns: text("archive_columns").notNull().default("default"),
  /**
   * The card design for this category's archive — the same vocabulary the
   * Customizer offers (classic, elevated, bordered, overlay, list, minimal),
   * with `default` following the site-wide choice. A news category and a
   * gallery category rarely want the same listing.
   */
  archiveCardStyle: text("archive_card_style").notNull().default("default"),
  /**
   * This category's own archive colours, as JSON keyed by the same setting
   * names the Customizer uses (`archive_title_color`, `archive_card_bg`, …).
   * One column rather than a dozen, and the same keys, so the term path and
   * the site path feed the identical CSS builders. Null = follow the site.
   */
  archiveDesign: text("archive_design"),

  // SEO. Named to match the columns on `posts` and `pages` so one reader works
  // for all three.
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  focusKeyword: text("focus_keyword"),
  canonicalUrl: text("canonical_url"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),

  // Robots directives combine, so each is its own flag.
  noIndex: integer("no_index", { mode: "boolean" }).notNull().default(false),
  noFollow: integer("no_follow", { mode: "boolean" }).notNull().default(false),
  noArchive: integer("no_archive", { mode: "boolean" }).notNull().default(false),
  noImageIndex: integer("no_image_index", { mode: "boolean" }).notNull().default(false),
  noSnippet: integer("no_snippet", { mode: "boolean" }).notNull().default(false),

  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  uniqueIndex("categories_language_slug_key").on(t.language, t.slug),
  index("categories_language_idx").on(t.language),
  index("categories_translation_group_idx").on(t.translationGroup),
  index("categories_parent_idx").on(t.parentId),
]);

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // Unique within a language, not globally — see the composite index below.
  slug: text("slug").notNull(),
  description: text("description"),
  /** Which language set this tag belongs to. Same reasoning as categories. */
  language: text("language").notNull().default("en"),
  /** Same override as categories.direction. */
  direction: text("direction"),
  /** Links this tag to the same tag in another language. */
  translationGroup: integer("translation_group"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  uniqueIndex("tags_language_slug_key").on(t.language, t.slug),
  index("tags_language_idx").on(t.language),
  index("tags_translation_group_idx").on(t.translationGroup),
]);

/**
 * Post ⇄ tag join.
 *
 * A composite primary key rather than a surrogate id: the pair is the identity,
 * and it makes tagging the same post twice impossible at the database level
 * instead of only in the code that writes it.
 */
export const postTags = sqliteTable(
  "post_tags",
  {
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] }), index("post_tags_tag_idx").on(t.tagId)]
);

/**
 * Post comments, including threaded replies.
 *
 * Comments arrive from the public internet, so they land as `pending` and only
 * become visible once approved. The author fields are plain columns rather than
 * a user reference: commenters are not accounts here.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * The document this comment belongs to — exactly one of these is set.
     *
     * A database CHECK (`comments_one_target`) enforces that, so "a comment
     * belongs to one thing" is a fact about the data rather than a rule the
     * application has to remember at every insert.
     */
    postId: integer("post_id").references(() => posts.id, { onDelete: "cascade" }),
    pageId: integer("page_id").references(() => pages.id, { onDelete: "cascade" }),
    /** Set when this is a reply. Self-references are added by the relation. */
    parentId: integer("parent_id"),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    authorUrl: text("author_url"),
    content: text("content").notNull(),
    /** pending | approved | spam | trash */
    status: text("status").notNull().default("pending"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
  },
  (t) => [
    index("comments_post_idx").on(t.postId, t.status),
    index("comments_page_status_created_idx").on(t.pageId, t.status, t.createdAt),
    // A comment belongs to exactly one of a post or a page.
    check("comments_one_target", sql`(${t.postId} IS NULL) <> (${t.pageId} IS NULL)`),
  ]
);

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  // Unique *within a language*, not globally — see the composite index
  // below. `/about` and `/fr/about` are different URLs with no reason to
  // fight over one slug.
  slug: text("slug").notNull(),
  excerpt: text("excerpt"),
  content: jsonText("content"),
  // Flattened body text for search; kept in sync on save. An FTS5 table
  // (posts_fts) indexes title + excerpt + this, see drizzle-d1/0000.
  searchText: text("search_text"),
  featuredImage: text("featured_image"),
  status: text("status").notNull().default("draft"),
  categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  seoKeywords: text("seo_keywords"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  twitterTitle: text("twitter_title"),
  twitterDescription: text("twitter_description"),
  twitterImage: text("twitter_image"),
  canonicalUrl: text("canonical_url"),
  noIndex: integer("no_index", { mode: "boolean" }).default(false),
  noFollow: integer("no_follow", { mode: "boolean" }).default(false),
  /** JSON, see lib/robots.ts; null when everything is at its default. */
  robotsAdvanced: text("robots_advanced"),
  schemaType: text("schema_type").default("Article"),
  /** Author-added JSON-LD entries (SEO → Schema) — see lib/schemaTypes.ts. */
  schemas: text("schemas"),
  // Per-post layout / design settings
  transparentHeader: text("transparent_header").notNull().default("default"),
  showTitle: text("show_title").notNull().default("default"),
  postLayout: text("post_layout").notNull().default("default"),
  contentStyle: text("content_style").notNull().default("default"),
  verticalSpacing: text("vertical_spacing").notNull().default("default"),
  showFeaturedImage: text("show_featured_image").notNull().default("default"),
  /**
   * Whether this post takes comments.
   *
   * `default` follows the site-wide `post_comments_show`; `enable`/`disable`
   * override it — the same three states as `showTitle`, so the column reads
   * the same way and needs no new vocabulary.
   */
  showComments: text("show_comments").notNull().default("default"),
  /**
   * In the trash since this moment, or null.
   *
   * A timestamp rather than a `trash` status: the status already records
   * whether the document was a draft or published, and overwriting it would
   * lose the state to restore *to*.
   */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  cssClasses: text("css_classes"),
  disableHeader: integer("disable_header", { mode: "boolean" }).notNull().default(false),
  disableFooter: integer("disable_footer", { mode: "boolean" }).notNull().default(false),
  /**
   * Which language this document is written in.
   *
   * Content is partitioned by language rather than shared: an Urdu site and an
   * English site living in one install do not share posts, they have their own.
   * `translation_group` is what links a document to its counterpart elsewhere,
   * so "show me the Urdu version" is answerable without the two being the same
   * row.
   */
  language: text("language").notNull().default("en"),
  /**
   * Writing direction override: "ltr" or "rtl". Null follows the language —
   * the site's Direction setting for the default language, the script's own
   * direction for any other. See documentDir().
   */
  direction: text("direction"),
  /** Shared across every translation of one thing. Null when it stands alone. */
  translationGroup: integer("translation_group"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  /**
   * Scripts for this document only.
   *
   * The site-wide pair in settings runs everywhere; a pixel for one landing
   * page or a widget on one article does not belong there. Raw markup by
   * design — that is what a tracking snippet is — which is why writing it is an
   * administrator's action, not an editor's.
   */
  scriptHead: text("script_head"),
  scriptBodyEnd: text("script_body_end"),
  /** CSS scoped to this document, so a one-page tweak is not a site-wide rule. */
  customCss: text("custom_css"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
},
  (t) => [
    // Listings are always scoped to one language now.
    uniqueIndex("posts_language_slug_key").on(t.language, t.slug),
    index("posts_language_idx").on(t.language, t.status, t.publishedAt),
    index("posts_translation_group_idx").on(t.translationGroup),
    // Every public listing is "published, newest first" — the archive, the
    // homepage, the feed, the sitemap, related posts and prev/next. Without
    // this the planner scans the whole table and sorts it each time.
    index("posts_status_published_idx").on(t.status, t.publishedAt),
    // Category archives and the related-posts query filter on this first.
    index("posts_category_idx").on(t.categoryId, t.publishedAt),
    // Author archives and "my posts" — see drizzle/0018_author_indexes.sql.
    index("posts_author_idx").on(t.authorId, t.publishedAt),
  ]
);

export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  // Unique *within a language*, not globally — see the composite index
  // below. `/about` and `/fr/about` are different URLs with no reason to
  // fight over one slug.
  slug: text("slug").notNull(),
  content: jsonText("content"),
  featuredImage: text("featured_image"),
  status: text("status").notNull().default("draft"),
  template: text("template").default("default"),
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  seoKeywords: text("seo_keywords"),
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  twitterTitle: text("twitter_title"),
  twitterDescription: text("twitter_description"),
  twitterImage: text("twitter_image"),
  canonicalUrl: text("canonical_url"),
  noIndex: integer("no_index", { mode: "boolean" }).default(false),
  noFollow: integer("no_follow", { mode: "boolean" }).default(false),
  robotsAdvanced: text("robots_advanced"),
  schemaType: text("schema_type").default("WebPage"),
  /** Author-added JSON-LD entries (SEO → Schema) — see lib/schemaTypes.ts. */
  schemas: text("schemas"),
  // Per-page layout / design settings
  transparentHeader: text("transparent_header").notNull().default("default"),
  showTitle: text("show_title").notNull().default("default"),
  postLayout: text("post_layout").notNull().default("default"),
  contentStyle: text("content_style").notNull().default("default"),
  verticalSpacing: text("vertical_spacing").notNull().default("default"),
  showFeaturedImage: text("show_featured_image").notNull().default("default"),
  /** The page's own override of the Customizer's page-comments default. */
  showComments: text("show_comments").notNull().default("default"),
  /**
   * In the trash since this moment, or null.
   *
   * A timestamp rather than a `trash` status: the status already records
   * whether the document was a draft or published, and overwriting it would
   * lose the state to restore *to*.
   */
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  cssClasses: text("css_classes"),
  disableHeader: integer("disable_header", { mode: "boolean" }).notNull().default(false),
  disableFooter: integer("disable_footer", { mode: "boolean" }).notNull().default(false),
  /** Same partitioning as posts — see the note there. */
  language: text("language").notNull().default("en"),
  /**
   * Writing direction override: "ltr" or "rtl". Null follows the language —
   * the site's Direction setting for the default language, the script's own
   * direction for any other. See documentDir().
   */
  direction: text("direction"),
  translationGroup: integer("translation_group"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  /**
   * Scripts for this document only.
   *
   * The site-wide pair in settings runs everywhere; a pixel for one landing
   * page or a widget on one article does not belong there. Raw markup by
   * design — that is what a tracking snippet is — which is why writing it is an
   * administrator's action, not an editor's.
   */
  scriptHead: text("script_head"),
  scriptBodyEnd: text("script_body_end"),
  /** CSS scoped to this document, so a one-page tweak is not a site-wide rule. */
  customCss: text("custom_css"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
},
  (t) => [
    uniqueIndex("pages_language_slug_key").on(t.language, t.slug),
    index("pages_language_idx").on(t.language, t.status),
    index("pages_translation_group_idx").on(t.translationGroup),
  ]
);

export const media = sqliteTable("media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  url: text("url").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  /**
   * Intrinsic pixel size, read from the file header at upload.
   *
   * Nullable because it is genuinely unknown for rows uploaded before this
   * existed, and for AVIF, whose header is not parsed. Every reader treats null
   * as "omit the attribute" rather than guessing — a wrong size reserves the
   * wrong space, which is worse than reserving none.
   */
  width: integer("width"),
  height: integer("height"),
  /**
   * A tiny blurred preview as a data URI (~400 bytes), made at upload. Shown
   * in the image's place while the real file loads, so it fades in rather
   * than popping into blank space. Null for SVG, GIF and older uploads.
   */
  blur: text("blur"),
  alt: text("alt"),
  caption: text("caption"),
  uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  // The image-size lookup resolves images by URL on every render that has one.
  index("media_url_idx").on(t.url),
]);

export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value"),
  type: text("type").default("text"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

export const menus = sqliteTable("menus", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  autoAddPages: integer("auto_add_pages", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

export const navItems = sqliteTable("nav_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  menuId: integer("menu_id").references(() => menus.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  objectType: text("object_type").default("custom"), // page | post | category | custom
  objectId: integer("object_id"),
  // Rich item options — icon, sub-label, badge, and mega-menu behaviour
  icon: text("icon"),
  description: text("description"),
  badge: text("badge"),
  highlight: text("highlight"),
  megaMenu: integer("mega_menu", { mode: "boolean" }).default(false),
  megaColumns: integer("mega_columns").default(2),
  url: text("url").notNull(),
  target: text("target").default("_self"),
  order: integer("order").default(0),
  parentId: integer("parent_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Media = typeof media.$inferSelect;
export type SiteSetting = typeof siteSettings.$inferSelect;
export type NavItem = typeof navItems.$inferSelect;

/**
 * Version history for posts and pages.
 *
 * One table for both kinds, keyed by (`documentKind`, `documentId`): two tables
 * would duplicate every query and every prune. The row holds the state *before*
 * a save, so a revision is always a version you can return to — the current
 * version already lives in `posts`/`pages` and does not need storing twice.
 */
export const revisions = sqliteTable("revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentKind: text("document_kind").notNull(),
  documentId: integer("document_id").notNull(),
  title: text("title"),
  content: jsonText("content"),
  excerpt: text("excerpt"),
  /** Slug, featured image, category, SEO/social/robots — see lib/revisions.ts. */
  meta: jsonText("meta"),
  // SET NULL, not CASCADE: removing a user must not delete the history of
  // everything they ever touched.
  authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [
  index("revisions_document_idx").on(t.documentKind, t.documentId, t.createdAt),
]);


export const redirects = sqliteTable("redirects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().unique(),
  destination: text("destination").notNull(),
  type: integer("type").notNull().default(301),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  hits: integer("hits").notNull().default(0),
  lastHit: integer("last_hit", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

export const notFoundLog = sqliteTable("not_found_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  hits: integer("hits").notNull().default(1),
  referrer: text("referrer"),
  lastHit: integer("last_hit", { mode: "timestamp_ms" }).default(NOW).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

// Installed plugins — tools uploaded as a zip and placed with a shortcode.
//
// The files live under public/plugins/<slug>/; this row is what the admin
// lists and what rendering consults: whether the plugin is on, its version
// (for cache-busting its script), and the settings the site owner chose.
export const plugins = sqliteTable("plugins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  version: text("version").notNull().default("1.0.0"),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** The plugin.json it was installed from, verbatim. */
  manifest: text("manifest").notNull(),
  /** Values for the settings the manifest declares, as JSON. */
  settings: text("settings").notNull().default("{}"),
  installedAt: integer("installed_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

// Errors the site has thrown, so they can be read from the admin.
//
// On shared hosting the server log is not something the site owner can open;
// a 500 is discovered by a visitor, and the only trace of it is gone by the
// time anyone looks. Everything that reaches Next's error hook is written
// here instead: what failed, where, and the stack — enough to fix it.
export const errorLog = sqliteTable("error_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** "render", "route", "middleware", "client" — where it surfaced. */
  source: text("source").notNull().default("render"),
  path: text("path"),
  method: text("method"),
  message: text("message").notNull(),
  stack: text("stack"),
  /** Next's error digest, the handle a visitor's error page shows. */
  digest: text("digest"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
}, (t) => [index("error_log_created_idx").on(t.createdAt)]);

// Reusable content injected at a layout hook — an announcement bar, a CTA under
// every post, a promo above the footer. The alternative is editing the layout
// for every one of them, which is what Elements exists to avoid.
export const elements = sqliteTable("elements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  content: jsonText("content"),
  /** Layout position, one of ELEMENT_HOOKS in src/lib/elements.ts. */
  hook: text("hook").notNull().default("before_footer"),
  status: text("status").notNull().default("draft"),
  /** Lower renders first when several elements share a hook. */
  priority: integer("priority").notNull().default(10),
  /** JSON: { include: PageType[], exclude: PageType[] }. Empty include = everywhere. */
  conditions: jsonText("conditions"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});

// Contact form submissions. The form's shape lives in the block that rendered
// it, so the payload is stored as-is rather than in fixed columns — one table
// serves every form on the site, whatever fields it has.
export const formSubmissions = sqliteTable("form_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The form block's name, so several forms can share this inbox. */
  formName: text("form_name").notNull().default("Contact"),
  /** Where it was submitted from, for context in the inbox. */
  pagePath: text("page_path"),
  data: jsonText("data").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).default(NOW).notNull(),
});
