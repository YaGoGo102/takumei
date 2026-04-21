export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', "https://" + targetHost + "/");
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

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
          newResponseHeaders.set('Location', "https://" + originHost + proxyPrefix + absoluteLoc);
        }
      }

      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // --- 改良ポイント：非破壊的な書き換え ---
      return new HTMLRewriter()
        .on('a, form, iframe', { // 表示に影響しにくい「遷移系」のみを優先
          element(el) {
            const attr = el.tagName === 'form' ? 'action' : 'href';
            let val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#') && !val.includes(originHost)) {
              try {
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, "https://" + originHost + proxyPrefix + absolute);
              } catch(e) {}
            }
          }
        })
        .on('head', {
          element(el) {
            // 安全な文字列連結でスクリプトを注入
            const scriptStr = '<script>' +
              'window.addEventListener("load", function() {' +
              '  var p = "https://' + originHost + proxyPrefix + '";' +
              '  document.addEventListener("click", function(e) {' +
              '    var a = e.target.closest("a");' +
              '    if (a && a.href && !a.href.includes("' + originHost + '")) {' +
              '      e.preventDefault();' +
              '      window.location.href = p + a.href;' +
              '    }' +
              '  }, true);' +
              '});' +
              '</script>';
            el.append(scriptStr, { html: true });
          }
        })
        .transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      // バッククォートを排除したエラーレスポンス
      return new Response("[takumei] Error: " + e.message, { status: 500 });
    }
  }
};
