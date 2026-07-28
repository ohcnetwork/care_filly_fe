import { Suspense, lazy } from "react";

const QuotasPage = lazy(() =>
  import("./components/admin/QuotasPage").then((m) => ({
    default: m.QuotasPage,
  })),
);
const QuotaUsagePage = lazy(() =>
  import("./components/admin/QuotaUsagePage").then((m) => ({
    default: m.QuotaUsagePage,
  })),
);

function AdminPage({ children }: { children: React.ReactNode }) {
  // Tailwind utilities in this plugin are scoped under
  // `.care-scribie-fe-container` (see index.css).
  return (
    <div className="care-scribie-fe-container">
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

const routes = {
  "/admin/scribe/quotas": () => (
    <AdminPage>
      <QuotasPage />
    </AdminPage>
  ),
  "/admin/scribe/quotas/:id": ({ id }: { id: string }) => (
    <AdminPage>
      <QuotaUsagePage quotaId={id} />
    </AdminPage>
  ),
};

export default routes;
