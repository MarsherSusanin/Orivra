export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    const isRead = ["GET", "HEAD"].includes(request.method);
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
    const lastSegment = url.pathname.split("/").at(-1) ?? "";
    const isAssetLike = lastSegment.includes(".");

    if (
      response.status !== 404 ||
      !acceptsHtml ||
      !isRead ||
      isApi ||
      isAssetLike
    ) {
      return response;
    }

    const indexUrl = url;
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
