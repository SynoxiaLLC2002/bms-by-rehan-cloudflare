import Header from "@/components/admin/Header";
import ErrorsPanel from "@/components/admin/ErrorsPanel";
import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/authz";
import { rawQuery } from "@/lib/db/raw";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export interface ErrorRow {
  id: number;
  source: string;
  path: string | null;
  method: string | null;
  message: string;
  stack: string | null;
  digest: string | null;
  user_agent: string | null;
  created_at: string;
  [column: string]: unknown;
}

/**
 * What the site has thrown, newest first. Administrators only — stacks
 * describe the code and the hosting.
 */
export default async function ErrorsPage() {
  const session = await auth();
  if (!isAdmin(session)) notFound();

  let rows: ErrorRow[] = [];
  let unavailable = "";
  try {
    // created_at is stored as milliseconds; the panel wants an ISO string.
    rows = (await rawQuery<ErrorRow & { created_at: number }>(
      "SELECT id, source, path, method, message, stack, digest, user_agent, created_at FROM error_log ORDER BY created_at DESC LIMIT 200"
    )).map((r) => ({ ...r, created_at: new Date(Number(r.created_at)).toISOString() }));
  } catch (err) {
    unavailable = err instanceof Error ? err.message : String(err);
  }

  return (
    <>
      <Header title="Errors" />
      <main className="flex-1 p-6">
        <div className="max-w-4xl">
          <ErrorsPanel rows={rows} unavailable={unavailable} />
        </div>
      </main>
    </>
  );
}
