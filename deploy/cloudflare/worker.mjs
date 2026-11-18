const studioOrigin = "https://ohmygame-oykgf161-workspace-75am3q.cloady.io";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/studio") {
      url.pathname = "/studio/";
      return Response.redirect(url, 308);
    }

    const api = url.pathname === "/api" || url.pathname.startsWith("/api/");
    if (!api && !url.pathname.startsWith("/studio/")) {
      return new Response("Not found", { status: 404 });
    }

    const upstream = new URL(studioOrigin);
    upstream.pathname = api ? url.pathname : url.pathname.slice("/studio".length);
    upstream.search = url.search;
    const proxied = new Request(upstream, request);
    proxied.headers.delete("cookie");
    const result = await fetch(proxied, { redirect: "manual" });
    const response = new Response(result.body, result);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  },
};
