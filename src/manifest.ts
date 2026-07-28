import { Mic } from "lucide-react";
import { createElement, lazy } from "react";

import routes from "./routes";

const ScribeController = lazy(
  () => import("./components/scribe/ScribeController"),
);

const manifest = {
  plugin: "care-eka-scribe-fe",
  routes,
  extends: ["Scribe"],
  components: {
    Scribe: ScribeController,
  },
  adminNavItems: [
    {
      url: "/admin/scribe/quotas",
      name: "Scribe Quotas",
      icon: createElement(Mic, { className: "h-4 w-4" }),
    },
  ],
  devices: [],
} as const;

export default manifest;
