import { useEffect, useState } from "react";
import { AppSidebar } from "./app-sidebar.js";
import { PagesAuthProvider } from "./auth.js";
import { GameStudioHome } from "./game-studio-home.js";
import { Home } from "./home.js";
import { MediaCreationHome } from "./media-creation-home.js";
import { PagesNotice } from "./pages-prompt.js";
import { parseAppRoute, sidebarHash, type AppNavigationTarget } from "./routes.js";
import { t } from "./i18n.js";

export function PagesPreview() {
  const [route, setRoute] = useState(() => parseAppRoute(location.hash));
  useEffect(() => {
    const read = () => setRoute(parseAppRoute(location.hash));
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const [unavailable, setUnavailable] = useState(false);
  function navigate(next: AppNavigationTarget) {
    if (next === "settings") { setUnavailable(true); return; }
    setUnavailable(false);
    location.hash = sidebarHash(next);
  }
  const noBackend = () => setUnavailable(true);
  const page = route.page;
  return <PagesAuthProvider>{page === "home"
    ? <Home pagesPreview onNavigate={navigate} onOpen={noBackend} onCreate={noBackend} />
    : page === "web-game" || page === "interactive-story" || page === "godot" || page === "general"
      ? <GameStudioHome key={page} pagesPreview projectType={page === "godot" ? "godot-game" : page} onNavigate={navigate} onOpenProject={noBackend} onCreate={noBackend} />
    : page === "image-generation" || page === "video-generation"
      ? <MediaCreationHome key={page} pagesPreview mode={page === "image-generation" ? "image" : "video"} onNavigate={navigate} onOpen={noBackend} />
      : <main className="home-shell must-studio-shell"><AppSidebar active={page === "projects" || page === "library" || page === "community" || page === "plugins" || page === "asset-canvas" ? page : "home"} onNavigate={navigate} pagesPreview />
        <section className="home-content"><h1>{t("pagesPreview.backend")}</h1><PagesNotice /><button type="button" onClick={() => navigate("home")}>{t("jointStudio.newTask")}</button></section>
      </main>}
    {unavailable ? <p className="must-pages-toast" role="status">{t("pagesPreview.backend")}</p> : null}
  </PagesAuthProvider>;
}
