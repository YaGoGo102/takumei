export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. ターゲットURLの決定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 日本地域・日本語・セーフサーチOFFをパラメータで強制
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストの構築（日本からのアクセスを完全に偽装）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
      
      // Cookieの同期とセーフサーチ強制
      let cookie = request.headers.get('Cookie') || '';
      const forceCookies = 'SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp;';
      newHeaders.set('Cookie', cookie ? `${cookie}; ${forceCookies}` : forceCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. レスポンスヘッダーの加工（クッキーのドメインを書き換え）
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      
      for (let c of setCookies) {
        // サイトのCookieをTakumeiドメインに紐付け、セキュリティ属性を緩和
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modified);
      }

      // リダイレクト先を絶対にTakumeiドメインに固定
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${absoluteLoc}`);
        }
      }

      // セキュリティ解除（SNSのログイン画面を表示させるために必須）
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');
      newResponseHeaders.set('Access-Control-Allow-Credentials', 'true');

      if (!response.headers.get('content-type')?.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // 4. HTMLRewriterによる「Takumeiドメイン」への監禁
      return new HTMLRewriter()
        .on('a, img, script, video, source, form, iframe', {
          element(el) {
            const attr = el.tagName === 'form' ? 'action' : (el.hasAttribute('href') ? 'href' : 'src');
            let val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#') && !val.includes(originHost)) {
              try {
                // 相対パスを解決してプロキシ経由の絶対URLに置換
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, `https://${originHost}${proxyPrefix}${absolute}`);
              } catch(e) {}
            }
            // 全てのリンクを「同じタブ（そのタブだけ）」で開かせる
            if (el.tagName === 'a') el.setAttribute('target', '_self');
          }
        })
        .transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      return new Response(`[takumei] Proxy Error: ${e.message}`, { status: 500 });
    }
  }
};
