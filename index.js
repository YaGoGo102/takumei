export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 検索エンジン側の地域・言語をより強力に固定
      targetUrlString = "https://www.bing.com/search?q=&setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      // 検索ループを防ぐため、リファラをターゲットドメインに偽装
      newHeaders.set('Referer', `https://${targetHost}/`);
      newHeaders.set('Origin', `https://${targetHost}`);
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieのドメイン書き換え（ここが外れると設定がリセットされます）
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modified);
      }

      // リダイレクトループを阻止し、必ずTakumeiドメインに繋ぐ
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          return new Response(null, {
            status: response.status,
            headers: { 'Location': `https://${originHost}${proxyPrefix}${absoluteLoc}` }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // HTMLの書き換え：フォームの「action（送信先）」を最優先で固定
      const rewriter = new HTMLRewriter()
        .on('form', {
          element(el) {
            const action = el.getAttribute('action');
            if (action) {
              const absolute = new URL(action, targetUrl.origin).href;
              el.setAttribute('action', `https://${originHost}${proxyPrefix}${absolute}`);
            }
          }
        })
        .on('a, img, script, video, source, iframe', {
          element(el) {
            const attr = el.hasAttribute('href') ? 'href' : 'src';
            let val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#') && !val.includes(originHost)) {
              try {
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, `https://${originHost}${proxyPrefix}${absolute}`);
              } catch(e) {}
            }
          }
        });

      return rewriter.transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      return new Response(`[takumei] Error: ${e.message}`, { status: 500 });
    }
  }
};
