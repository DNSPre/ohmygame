import { useEffect } from "react";
import { PagesAuthProvider } from "./auth.js";
import { Home } from "./home.js";
import { parseAppRoute, projectHash, settingsHash, sidebarHash, DEFAULT_SETTINGS_SECTION, type AppNavigationTarget } from "./routes.js";

const studioPath = "/studio/";

function navigate(target: AppNavigationTarget) {
  if (target === "web-game") {
    location.assign("/play/");
    return;
  }
  const hash = target === "settings" ? settingsHash(DEFAULT_SETTINGS_SECTION) : sidebarHash(target);
  location.assign(studioPath + hash);
}

export function PagesPreview() {
  useEffect(() => {
    function openExistingLink() {
      const page = parseAppRoute(location.hash).page;
      if (page === "web-game") {
        location.replace("/play/");
      } else if (page !== "home") {
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
