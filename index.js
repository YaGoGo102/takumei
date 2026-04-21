export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 目的地特定ロジック
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // クッキーから「現在滞在中のドメイン」を復元（リファラより正確）
      const lastDomain = request.headers.get('Cookie')?.match(/last_target=([^;]+)/)?.[1];
      if (lastDomain && url.pathname !== "/") {
        targetUrlString = `https://${lastDomain}${url.pathname}${url.search}`;
      } else {
        targetUrlString = "https://www.bing.com";
      }
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetUrl.host);
      newHeaders.set('Referer', targetUrl.origin);

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        redirect: 'manual'
      });

      // レスポンスヘッダーの加工
      const modifiedHeaders = new Headers(response.headers);
      modifiedHeaders.set('Access-Control-Allow-Origin', '*');
      modifiedHeaders.delete('content-security-policy');
      modifiedHeaders.delete('x-frame-options');
      
      // 今のドメインをクッキーに保存（次回の相対パス解決用）
      modifiedHeaders.append('Set-Cookie', `last_target=${targetUrl.host}; Path=/; HttpOnly`);

      // HTML以外（画像・動画）はそのまま返す
      if (!response.headers.get('content-type')?.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: modifiedHeaders });
      }

      // 【HTMLRewriter】による超高速・正確な書き換え
      const rewriter = new HTMLRewriter()
        // リンク、画像、スクリプト、ビデオ、フォームの送信先をすべて変換
        .on('a, img, script, video, source, form', {
          element(el) {
            const attr = el.tagName === 'form' ? 'action' : (el.hasAttribute('href') ? 'href' : 'src');
            const val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#')) {
              try {
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, `https://${originHost}${proxyPrefix}${absolute}`);
              } catch(e) {}
            }
            // 新しいタブで開くのを禁止
            if (el.tagName === 'a') el.setAttribute('target', '_self');
          }
        })
        // 邪魔な広告やバナーを消去する（例として「ad」が含まれるクラスを消す）
        .on('div[class*="ad"], ins.adsbygoogle', {
          element(el) { el.remove(); }
        })
        // 自分の好きなCSSを注入してデザイン変更
        .on('head', {
          element(el) {
            el.append('<style>/* ここに自分好みのCSSを書く */ body { filter: contrast(1.1); }</style>', { html: true });
          }
        });

      return rewriter.transform(new Response(response.body, { status: response.status, headers: modifiedHeaders }));

    } catch (e) {
      return new Response("改良プロキシエラー: " + e.message, { status: 500 });
    }
  }
};
