const studioOrigin = "https://ohmygame-oykgf161-workspace-75am3q.cloady.io";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/studio" || url.pathname.startsWith("/studio/")) {
      // Old bookmarks enter the public, browser-local workspace. HTTP redirects
      // preserve the original fragment, including the requested settings page.
      url.pathname = "/";
      return new Response(null, { status: 302, headers: { Location: url.href, "Cache-Control": "no-store" } });
    }

    const api = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (!api) {
      return new Response("Not found", { status: 404 });
    }

    const upstream = new URL(studioOrigin);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const proxied = new Request(upstream, request);
    proxied.headers.delete("cookie");
    const result = await fetch(proxied, { redirect: "manual" });
    const response = new Response(result.body, result);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  },
};
