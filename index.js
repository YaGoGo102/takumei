export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;

    // 1. 今どのサイトを表示すべきか判断する
    // URLの末尾が /proxy/https://... という形式ならその先へ、そうでなければDuckDuckGoへ
    let targetUrlString = "";
    const proxyPrefix = "/proxy/";

    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期状態はDuckDuckGo
      targetUrlString = "https://duckduckgo.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      const contentType = response.headers.get('content-type') || '';

      // 2. HTMLの中身を書き換えて「自分のドメイン」を固定する
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // ページ内のすべての「https://...」というリンクを
        // 「https://自分のドメイン/proxy/https://...」に書き換える
        body = body.replace(/(href|src)="https?:\/\/([^"]+)"/g, (match, attr, p1) => {
          // すでに自分のドメインなら書き換えない
          if (match.includes(originHost)) return match;
          
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `${attr}="https://${originHost}/proxy/${fullUrl}"`;
        });

        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, {
          status: response.status,
          headers: newResponseHeaders
        });
      }

      // 画像などはそのまま中継
      return response;

    } catch (e) {
      return new Response("URL形式が正しくありません。 /proxy/https://... の形式でアクセスしてください。", { status: 400 });
    }
  }
};
