// Puts the page's own stylesheets (/site/s-… and /site/f-…, written by
// SiteLayout through lib/cssStore) into the HTML in place of their <link>s,
// as server.js did on Node: the first paint waits for no request. A sheet this
// isolate did not render stays a link, which /site/<name>.css answers from R2.
import { memoryCss } from "@/lib/cssStore";

export function inlineStoredCss(html: string): string {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel="stylesheet"/i.test(tag)) return tag;
    const m = tag.match(/\shref="\/site\/([sf]-[a-f0-9]{8,40})\.css"/i);
    const css = m ? memoryCss(m[1]) : null;
    if (css === null) return tag;
    const precedence = (tag.match(/\sdata-precedence="([^"]*)"/i) || [])[1];
    // `</style` inside the CSS would end the element early.
    return `<style data-href="/site/${m![1]}.css"${precedence ? ` data-precedence="${precedence}"` : ""}>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
  });
}
