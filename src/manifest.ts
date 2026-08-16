import { Mic } from "lucide-react";
import { createElement, lazy } from "react";

import routes from "./routes";

const FillyController = lazy(
  () => import("./components/filly/FillyController"),
);

const FillyProfileSection = lazy(
  () => import("./components/filly/FillyProfileSection"),
);

const manifest = {
  plugin: "care-filly-fe",
  routes,
  extends: ["Scribe", "UserProfileSections"],
  components: {
    Scribe: FillyController,
    UserProfileSections: FillyProfileSection,
  },
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
