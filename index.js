export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // DuckDuckGoに戻す（ここならブロックされにくい）
      targetUrlString = "https://duckduckgo.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual'
      }));

      let body = await response.text();
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        // 全ての https:// を 自分のURL/proxy/https:// に変える魔法
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+)/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });
      }

      return new Response(body, {
        status: response.status,
        headers: response.headers
      });
    } catch (e) {
      return new Response("Error: " + e.message);
    }
  }
};
