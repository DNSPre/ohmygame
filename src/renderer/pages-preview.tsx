import { useEffect } from "react";
import { PagesAuthProvider } from "./auth.js";
import { Home } from "./home.js";
import { parseAppRoute, projectHash, settingsHash, sidebarHash, DEFAULT_SETTINGS_SECTION, type AppNavigationTarget } from "./routes.js";

const studioPath = "/studio/";

function navigate(target: AppNavigationTarget) {
  const hash = target === "settings" ? settingsHash(DEFAULT_SETTINGS_SECTION) : sidebarHash(target);
  location.assign(studioPath + hash);
}

export function PagesPreview() {
  useEffect(() => {
    function openExistingLink() {
      if (parseAppRoute(location.hash).page !== "home") {
        location.replace(studioPath + location.hash);
      }
    }
    openExistingLink();
    window.addEventListener("hashchange", openExistingLink);
    return () => window.removeEventListener("hashchange", openExistingLink);
  }, []);

  return <PagesAuthProvider>
    <Home pagesPreview onNavigate={navigate} onOpen={(id) => location.assign(studioPath + projectHash(id))} onCreate={() => navigate("home")} />
  </PagesAuthProvider>;
}
