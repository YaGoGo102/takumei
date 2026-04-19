export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host; // takumei.goku-0102-gg.workers.dev
    const proxyPrefix = "/proxy/";

    // 1. ターゲットの特定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);

      // セーフサーチOFF
      let clientCookie = request.headers.get('Cookie') || '';
      const safeSearchOff = "SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp; safe=off";
      newHeaders.set('Cookie', clientCookie ? `${clientCookie}; ${safeSearchOff}` : safeSearchOff);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieのドメイン書き換え
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      // 2. リダイレクト先を絶対にTakumeiドメインに固定
      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          if (!location.startsWith('http')) {
            location = new URL(location, targetUrl.origin).href;
          }
          return new Response(null, {
            status: response.status,
            headers: { 'Location': `https://${originHost}${proxyPrefix}${location}` }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // --- URL固定の魔法（強化版） ---
        
        // ① https://... 形式をすべて置換
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match, p1) => {
          if (match.includes(originHost)) return match;
          return `href="https://${originHost}${proxyPrefix}https://${p1}"`;
        });

        // ② //example.com 形式（プロトコル相対）を置換
        body = body.replace(/href="\/\/([^"]+)"/g, `href="https://${originHost}${proxyPrefix}https://$1"`);

        // ③ /path/to... 形式（ルート相対）を置換
        body = body.replace(/href="\/(?!\/)([^"]+)"/g, `href="https://${originHost}${proxyPrefix}${targetUrl.origin}/$1"`);

        // ついでに画像(src)も同様に書き換えると、デザインが崩れにくくなります
        body = body.replace(/src="\/(?!\/)([^"]+)"/g, `src="https://${originHost}${proxyPrefix}${targetUrl.origin}/$1"`);

        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("中継エラー: " + e.message, { status: 400 });
    }
  }
};
