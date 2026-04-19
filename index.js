export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    // 1. ターゲットURLの決定
    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値（Bing）
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 2. リクエストヘッダーの構築
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);

      // --- セーフサーチOFFの強制注入 ---
      let clientCookie = request.headers.get('Cookie') || '';
      // 各検索エンジンのOFF設定クッキーを合体させる
      const safeSearchOffCookies = "SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0; mkt=ja-jp; safe=off";
      newHeaders.set('Cookie', clientCookie ? `${clientCookie}; ${safeSearchOffCookies}` : safeSearchOffCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 3. レスポンスヘッダー（クッキー）の自分のドメインへの書き換え
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie(); // 全てのクッキーを取得
      
      newResponseHeaders.delete('set-cookie'); // 一度消して再構築
      for (let cookie of setCookies) {
        // クッキーの通用ドメインを「相手のドメイン」から「自分のドメイン」へ書き換え
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        // セキュア設定などで弾かれないよう調整
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, ''); 
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      // 4. HTMLの書き換え（URL固定）
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // ページ内の絶対URLを自分経由に
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match) => {
          if (match.includes(originHost)) return match;
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `href="https://${originHost}${proxyPrefix}${fullUrl}"`;
        });

        // 相対パスを自分経由の絶対パスに
        body = body.replace(/(href|src|action)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        // セキュリティ制限を解除
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("プロキシエラー: " + e.message, { status: 400 });
    }
  }
};
