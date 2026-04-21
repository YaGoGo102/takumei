export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 検索ループを防ぐため、最初から日本語設定のBingへ誘導
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', `https://${targetHost}/`);
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieの名義変更
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let c of setCookies) {
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modified);
      }

      // リダイレクトの完全捕獲
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

      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // HTMLRewriterによる処理
      return new HTMLRewriter()
        .on('head', {
          element(el) {
            // サイトの消滅を防ぐため、実行タイミングを調整した守護神スクリプト
            el.append(`
              <script>
                window.addEventListener('DOMContentLoaded', () => {
                  const p = "https://${originHost}${proxyPrefix}";
                  
                  // リンククリックの奪取
                  document.addEventListener('click', e => {
                    const a = e.target.closest('a');
                    if (a && a.href && !a.href.includes('${originHost}')) {
                      e.preventDefault();
                      window.location.href = p + a.href;
                    }
                  }, true);

                  // フォーム送信の奪取
                  document.addEventListener('submit', e => {
                    const form = e.target;
                    if (form.action && !form.action.includes('${originHost}')) {
                      const target = new URL(form.action, window.location.href).href;
                      form.action = p + target;
                    }
                  }, true);
                });
              </script>
            `, { html: true });
          }
        })
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
          }
        })
        .transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      // エラー時のレスポンスを修正
      return new Response("[takumei] Error: " + e.message, { status: 500 });
    }
  }
};
