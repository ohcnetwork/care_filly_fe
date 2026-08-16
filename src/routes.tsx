import { Suspense, lazy } from "react";

const FillySettingsPage = lazy(
  () => import("./components/filly/FillySettingsPage"),
);

const routes = {
  "/facility/:facilityId/users/:user/filly": () => (
    <Suspense fallback={null}>
      <FillySettingsPage />
    </Suspense>
  ),
};

export default routes;
