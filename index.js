export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. 目的地を特定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値：Bingの日本語設定
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. 基本的なヘッダー設定
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', "https://" + targetHost + "/");

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. Cookieとリダイレクトの正常化
      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieのドメインを自分のものに書き換え
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modified);
      }

      // リダイレクト先をプロキシURLに強制修正
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', "https://" + originHost + proxyPrefix + absoluteLoc);
        }
      }

      // セキュリティ制限（CSP/XFO）を削除して表示を許可
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');

      // HTML以外はそのまま返す
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // 4. HTMLRewriterでタグのURLを書き換え
      return new HTMLRewriter()
        .on('a, form, img, script, iframe', {
          element(el) {
            const attr = el.tagName === 'form' ? 'action' : (el.hasAttribute('href') ? 'href' : 'src');
            let val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#') && !val.includes(originHost)) {
              try {
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, "https://" + originHost + proxyPrefix + absolute);
              } catch(e) {}
            }
          }
        })
        .transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      // ビルドエラー回避のためバッククォートを使わず出力
      return new Response("Error: " + e.message, { status: 500 });
    }
  }
};
