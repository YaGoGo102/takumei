export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: new Headers(request.headers),
        redirect: 'manual'
      }));

      const newResponseHeaders = new Headers(response.headers);
      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html')) {
        let body = await response.text();

        // 【修正1】リンクの書き換え ＋ 新しいタブ禁止
        // target="_blank" を target="_self"（同じタブ）に強制変更
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match) => {
          if (match.includes(originHost)) return match;
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `href="https://${originHost}${proxyPrefix}${fullUrl}" target="_self"`;
        });

        // 【修正2】相対パスも同じタブで開くように強制
        body = body.replace(/href="\/(?!\/)([^"]+)"/g, (match, p1) => {
          return `href="https://${originHost}${proxyPrefix}${targetUrl.origin}/${p1}" target="_self"`;
        });

        // 【修正3】JavaScriptでの「新しいウィンドウ」を封じる
        // ページの最後に、動作を上書きするスクリプトを流し込む
        const injectionScript = `
          <script>
            // リンククリック時に新しいタブで開くのを阻止
            document.addEventListener('click', function(e) {
              const target = e.target.closest('a');
              if (target && target.target === '_blank') {
                target.target = '_self';
              }
            }, true);
            // window.open を自分のプロキシ経由に書き換える
            const originalOpen = window.open;
            window.open = function(url, name, specs) {
              if (url && !url.includes('${originHost}')) {
                const proxyUrl = "https://${originHost}${proxyPrefix}" + new URL(url, window.location.href).href;
                return originalOpen(proxyUrl, '_self', specs);
              }
              return originalOpen(url, '_self', specs);
            };
          </script>
        `;
        body = body.replace('</body>', injectionScript + '</body>');

        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;
    } catch (e) {
      return new Response("Error: " + e.message);
    }
  }
};
