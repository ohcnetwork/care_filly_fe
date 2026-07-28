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
const ScribeSettingsPage = lazy(
  () => import("./components/scribe/ScribeSettingsPage"),
);

function AdminPage({ children }: { children: React.ReactNode }) {
  // Tailwind utilities in this plugin are scoped under
  // `.care-filly-fe-container` (see index.css).
  return (
    <div className="care-filly-fe-container">
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
  "/facility/:facilityId/users/:user/filly": () => (
    <Suspense fallback={null}>
      <ScribeSettingsPage />
    </Suspense>
  ),
};

export default routes;
