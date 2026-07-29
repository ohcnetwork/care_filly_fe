import { Mic } from "lucide-react";
import { createElement, lazy } from "react";

import routes from "./routes";

const ScribeController = lazy(
  () => import("./components/scribe/ScribeController"),
);

const ScribeProfileSection = lazy(
  () => import("./components/scribe/ScribeProfileSection"),
);

const manifest = {
  plugin: "care-filly-fe",
  routes,
  extends: ["Scribe", "UserProfileSections"],
  components: {
    Scribe: ScribeController,
    UserProfileSections: ScribeProfileSection,
  },
  adminNavItems: [
    {
      url: "/admin/filly/quotas",
      name: "Filly Quotas",
      icon: createElement(Mic, { className: "h-4 w-4" }),
    },
  ],
  userNavItems: [
    {
      name: "Filly",
      url: "filly",
      icon: createElement(Mic, { className: "h-4 w-4" }),
    },
  ],
  devices: [],
} as const;

export default manifest;
