export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. ターゲットURLの決定（/proxy/以降があればそこへ、なければBingへ）
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストヘッダーの準備
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);

      // --- セーフサーチOFF & 認証クッキーの統合 ---
      let clientCookie = request.headers.get('Cookie') || '';
      // 検索エンジンへの「制限オフ」命令を追加
      const safeSearchOff = "SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp; safe=off";
      newHeaders.set('Cookie', clientCookie ? `${clientCookie}; ${safeSearchOff}` : safeSearchOff);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. レスポンスヘッダー（クッキーとリダイレクト）の書き換え
      const newResponseHeaders = new Headers(response.headers);
      
      // サイトからのCookieを自分のドメイン用に「名義変更」する
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        // ドメイン属性を削除して自分のWorkersドメインで強制保存させる
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      // リダイレクト先もプロキシ経由に固定
      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          if (!location.startsWith('http')) {
            location = new URL(location, targetUrl.origin).href;
          }
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${location}`);
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // 4. HTMLの中身を「全URL固定」に書き換え
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // ページ内の絶対リンクを書き換え
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match) => {
          if (match.includes(originHost)) return match;
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `href="https://${originHost}${proxyPrefix}${fullUrl}"`;
        });

        // ページ内の相対リンクも書き換え
        body = body.replace(/href="\/(?!\/)([^"]+)"/g, (match, p1) => {
          return `href="https://${originHost}${proxyPrefix}${targetUrl.origin}/${p1}"`;
        });

        // セキュリティ制限（CSPなど）を解除して、外部コンテンツの読み込みを許可
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("中継エラー: " + e.message, { status: 400 });
    }
  }
};
