export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. 目的地（targetUrl）の判定を厳密にする
    let targetUrlString = "";
    
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else if (url.pathname !== "/") {
      // 400エラー対策：/proxy/ が抜けている相対パスを自動補完する
      // 直前にどのサイトを見ていたか（Referer）から推測する
      const referer = request.headers.get('Referer');
      if (referer && referer.includes(proxyPrefix)) {
        const lastSite = referer.split(proxyPrefix)[1];
        const lastOrigin = new URL(lastSite).origin;
        targetUrlString = lastOrigin + url.pathname + url.search;
      }
    }

    // まだ目的地が決まっていない（トップページなど）ならBingへ
    if (!targetUrlString || targetUrlString === "") {
      targetUrlString = "https://www.bing.com";
    }

    // URLが正しい形式かチェック（ここで400エラーを未然に防ぐ）
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlString);
    } catch (e) {
      return new Response("Invalid URL: " + targetUrlString, { status: 400 });
    }

    try {
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

      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieのドメイン書き換え（ログイン・設定維持）
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      // 動画サイトの制限解除
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentType = response.headers.get('content-type') || '';

      // HTML/JSの中身をすべて「Takumeiドメイン」に書き換える
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // あらゆるURLをプロキシ経由に
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // 相対パスの固定（/から始まるリンクを絶対URLに変換）
        body = body.replace(/(href|src|action|data-url)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("Proxy Connection Error: " + e.message, { status: 500 });
    }
  }
};
