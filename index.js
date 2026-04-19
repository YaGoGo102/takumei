export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. ターゲットURLの決定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      // プロキシ経由のアクセス（検索結果の先など）
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // デフォルトはGoogle検索
      targetUrlString = "https://www.google.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストの構築（Googleに拒否されないためのヘッダー設定）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', 'https://www.google.com/');
      // モバイル版ではなくPC版を表示させるためのUser-Agent
      newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' // Googleのリダイレクトを自分で制御する
      }));

      // 3. Google特有のリダイレクト処理
      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          if (!location.startsWith('http')) {
            location = new URL(location, targetUrl.origin).href;
          }
          const newLocation = `https://${originHost}${proxyPrefix}${location}`;
          return new Response(null, {
            status: response.status,
            headers: { 'Location': newLocation }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // 4. HTML内の全リンクを「自分のドメイン/proxy/...」に書き換える
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // ページ内の絶対URL (https://...) を書き換え
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match, p1) => {
          if (match.includes(originHost)) return match;
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `href="https://${originHost}${proxyPrefix}${fullUrl}"`;
        });

        // Googleの相対パスリンク (/search?q=...) も書き換え
        body = body.replace(/href="\/([^"]+)"/g, (match, p1) => {
          return `href="https://${originHost}${proxyPrefix}${targetUrl.origin}/${p1}"`;
        });

        const newResponseHeaders = new Headers(response.headers);
        // セキュリティ解除
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(body, {
          status: response.status,
          headers: newResponseHeaders
        });
      }

      return response;

    } catch (e) {
      return new Response("Google中継エラー: " + e.message, { status: 400 });
    }
  }
};
