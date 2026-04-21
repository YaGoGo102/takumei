export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値：日本設定のBing
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      const newResponseHeaders = new Headers(response.headers);
      
      // 1. Cookieの名義変更（認証維持とドメイン固定の鍵）
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modified);
      }

      // 2. 強力なリダイレクト固定
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

      // 3. セキュリティ解除（SNSログイン等の安定化）
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // 4. HTMLRewriter ＆ JavaScript注入による「URL完全固定」
      let body = await response.text();
      
      // HTML内のタグを書き換え
      const rewrittenBody = await new HTMLRewriter()
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
        .transform(new Response(body)).text();

      // ブラウザ上での動的なURL変更を監視して強制修正するスクリプト
      const finalScript = `
        <script>
          (function() {
            const origin = "https://${originHost}${proxyPrefix}";
            // 全てのクリックイベントをキャッチしてプロキシURLに変換
            document.addEventListener('click', e => {
              const a = e.target.closest('a');
              if (a && a.href && !a.href.includes('${originHost}')) {
                e.preventDefault();
                window.location.href = origin + a.href;
              }
            }, true);
            // JavaScriptによる window.open などを無効化
            const oldOpen = window.open;
            window.open = function(url) {
              return oldOpen(url.startsWith('http') ? origin + url : url, '_self');
            };
          })();
        </script>
      `;

      return new Response(rewrittenBody.replace('</body>', finalScript + '</body>'), {
        headers: newResponseHeaders
      });

    } catch (e) {
      return new Response(`[takumei] System Error: ${e.message}`, { status: 500 });
    }
  }
};
