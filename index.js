export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. ターゲットURLの特定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 最初はBing（またはお好きな検索エンジン）を表示
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // 2. リダイレクト（Locationヘッダー）の徹底書き換え
      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          if (!location.startsWith('http')) {
            location = new URL(location, targetUrl.origin).href;
          }
          return new Response(null, {
            status: response.status,
            headers: { 'Location': `https://${originHost}${proxyPrefix}${location}` }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // 3. HTML / CSS / JS 全ての中身を「自分のWorkers」経由に書き換える
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // 【魔法の置換】あらゆるURL (http/https) を自分経由に変換
        // 自分のドメインが含まれていない場合のみ、/proxy/を頭に付ける
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // 相対パス (/foo/bar) も自分経由の絶対URLに変換
        // href="/" や src="/js/..." などを対象にする
        body = body.replace(/(href|src|action)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        const newResponseHeaders = new Headers(response.headers);
        // セキュリティ制限を完全に解除（これをしないと外部URLが動かない）
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
      return new Response("中継エラー: " + e.message, { status: 400 });
    }
  }
};
