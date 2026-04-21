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
      // DuckDuckGoの日本地域・日本語・セーフサーチOFF設定
      // kl=jp-jp (日本地域), kp=-2 (セーフサーチオフ)
      targetUrlString = "https://duckduckgo.com/?kl=jp-jp&kp=-2";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストの構築（日本からのアクセスを偽装）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', 'https://duckduckgo.com/');
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
      
      // Cookieでの設定維持（DuckDuckGo用）
      let cookie = request.headers.get('Cookie') || '';
      const forceCookies = 'l=jp-jp; p=-2; ay=b;'; // 日本語設定とセーフサーチオフ
      newHeaders.set('Cookie', cookie ? `${cookie}; ${forceCookies}` : forceCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. レスポンスヘッダーの加工（クッキー・リダイレクトのドメイン変換）
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modified);
      }

      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${absoluteLoc}`);
        }
      }

      // セキュリティ解除
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');

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
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, `https://${originHost}${proxyPrefix}${absolute}`);
              } catch(e) {}
            }
            // 同じタブで開くことを強制
            if (el.tagName === 'a') el.setAttribute('target', '_self');
          }
        })
        .transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      return new Response(`[takumei] Proxy Error: ${e.message}`, { status: 500 });
    }
  }
};
