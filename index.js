export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. 目的地の特定と解決
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値：日本地域、日本語、セーフサーチOFFをパラメータで強制
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストヘッダーの構築（日本からのアクセスを完全に装う）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
      
      // クッキー認証 ＆ セーフサーチOFF
      let cookie = request.headers.get('Cookie') || '';
      const forceCookies = 'SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp;';
      newHeaders.set('Cookie', cookie ? `${cookie}; ${forceCookies}` : forceCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. レスポンスヘッダーの加工（ドメイン名義変更）
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      
      for (let c of setCookies) {
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

      // セキュリティ解除
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // 4. HTMLRewriterによる高速タグ置換 ＆ JS注入
      const rewriter = new HTMLRewriter()
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
            if (el.tagName === 'a') el.setAttribute('target', '_self');
          }
        })
        .on('head', {
          element(el) {
            // ブラウザ内でのURL脱走を監視するスクリプトを注入
            el.append(`
              <script>
                (function() {
                  const p = "https://${originHost}${proxyPrefix}";
                  // 動的なリンククリックを監視
                  document.addEventListener('click', e => {
                    const a = e.target.closest('a');
                    if (a && a.href && !a.href.includes('${originHost}')) {
                      e.preventDefault();
                      window.location.href = p + a.href;
                    }
                  }, true);
                  // JavaScriptのURL変更をフック（一部）
                  const oldOpen = window.open;
                  window.open = function(u) { return oldOpen(u.startsWith('http') ? p + u : u, '_self'); };
                })();
              </script>
            `, { html: true });
          }
        });

      return rewriter.transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      return new Response(`[takumei] Error: ${e.message}`, { status: 500 });
    }
  }
};
