import Header from "@/components/admin/Header";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/authz";
import { adminScreens } from "@/lib/plugins";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * A plugin's admin screen: the https page its plugin.json names under "admin", embedded full size.
 * The page is another site, so the browser keeps it apart from the admin: it keeps its own login and
 * cannot read the admin's cookies or pages. The sandbox also stops it from navigating the admin away.
 * Administrators only, like the Plugins screen that installs it.
 */
export default async function PluginAdminPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!isAdmin(session)) notFound();
  const { slug } = await params;
  const screen = (await adminScreens()).find((s) => s.slug === slug);
  if (!screen) notFound();
  return (
    <>
      <Header title={screen.label} />
      <main className="flex-1 flex flex-col min-h-0">
        <iframe
          src={screen.url}
          title={screen.label}
          className="flex-1 w-full border-0 bg-white"
          style={{ minHeight: "calc(100vh - 65px)" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
          referrerPolicy="no-referrer"
        />
        <p className="px-6 py-2 text-xs text-slate-500 border-t border-slate-200">
          From the plugin &ldquo;{slug}&rdquo;. <a className="underline" href={screen.url} target="_blank" rel="noopener noreferrer">Open in its own tab</a>
        </p>
      </main>
    </>
  );
}
