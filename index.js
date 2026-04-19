export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host; // takumei.goku-0102-gg.workers.dev
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";

    // 1. ターゲットURLの正確な特定
    if (url.pathname.startsWith(proxyPrefix)) {
      // 明示的なプロキシリクエスト
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else if (url.pathname !== "/") {
      // 【正確性の鍵】 /proxy/ がないリクエスト（画像やJSなど）をリファラから復元
      const referer = request.headers.get('Referer');
      if (referer && referer.includes(proxyPrefix)) {
        try {
          const refererUrl = new URL(referer);
          const lastTargetUrl = new URL(refererUrl.pathname.slice(proxyPrefix.length));
          targetUrlString = lastTargetUrl.origin + url.pathname + url.search;
        } catch (e) { /* ignore */ }
      }
    }

    // 目的地がない場合はBingへ
    if (!targetUrlString) targetUrlString = "https://www.bing.com";
    if (!targetUrlString.startsWith('http')) targetUrlString = 'https://' + targetUrlString;

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストヘッダーの完全偽装
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      newHeaders.set('Origin', targetUrl.origin);
      
      // クッキーの引き継ぎ
      let cookie = request.headers.get('Cookie') || '';
      if (!cookie.includes('ADLT=OFF')) cookie += '; SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; safe=off';
      newHeaders.set('Cookie', cookie);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // 3. レスポンスの加工（正確なドメイン変換）
      const newResponseHeaders = new Headers(response.headers);
      
      // Set-Cookieのドメイン書き換え（ここが認証維持に必須）
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, ''); // Domain属性を消して自ドメインに固定
        newResponseHeaders.append('set-cookie', modified);
      }

      // リダイレクトの強制固定
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const absLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${absLoc}`);
        }
      }

      const contentType = response.headers.get('content-type') || '';
      
      // HTML/JS/CSS の中身を正確に書き換え
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // 全てのURLをプロキシ経由に
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // 相対パスの固定（a, img, script, form, sourceに対応）
        body = body.replace(/(href|src|action|data-url|srcset)="\/+(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        // セキュリティ制限の完全除去
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return new Response(response.body, { status: response.status, headers: newResponseHeaders });

    } catch (e) {
      return new Response(`[Takumei Proxy Error]: ${e.message}`, { status: 500 });
    }
  }
};
