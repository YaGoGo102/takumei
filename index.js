export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host; // takumei.goku-0102-gg.workers.dev
    const proxyPrefix = "/proxy/";

    // 1. 目的地を特定する
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 最初はBingを表示
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストの構築
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      
      // クッキー認証 ＆ セーフサーチOFFの統合
      let clientCookie = request.headers.get('Cookie') || '';
      const safeSearchOff = "SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp; safe=off";
      newHeaders.set('Cookie', clientCookie ? `${clientCookie}; ${safeSearchOff}` : safeSearchOff);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. 全てのレスポンスヘッダーを「自分名義」に書き換え
      const newResponseHeaders = new Headers(response.headers);
      
      // Cookieのドメインを自分のものに
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      // リダイレクト先を絶対に自分のドメインに繋ぎ止める
      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${absoluteLoc}`);
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // 4. 【最強の置換】HTML / JS / CSS の中身を全て自分経由に書き換える
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // サイト内のあらゆる「http(s)://」を「自分のURL/proxy/http(s)://」に書き換える
        // これにより、JavaScript内の隠れたリンクも強制的に固定されます
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match; // 自分のドメインならそのまま
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // リンク(href)や画像(src)の相対パス「/foo/bar」も自分経由に
        body = body.replace(/(href|src|action|data-url)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        // 5. 【トドメ】ブラウザ上でもドメイン漏れを監視するスクリプトを注入
        if (contentType.includes('text/html')) {
          const injection = `
            <script>
              // リンククリック時に、もし書き換え漏れがあればその場で修正して飛ぶ
              document.addEventListener('click', e => {
                const a = e.target.closest('a');
                if (a && a.href && !a.href.includes('${originHost}')) {
                  e.preventDefault();
                  window.location.href = "https://${originHost}${proxyPrefix}" + a.href;
                }
              }, true);
            </script>
          `;
          body = body.replace('</body>', injection + '</body>');
        }

        // セキュリティ制限を完全に解除
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("中継エラー: " + e.message, { status: 500 });
    }
  }
};
