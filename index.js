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
      const targetHost = targetUrl.host;

      // 1. リクエストヘッダーの準備（ブラウザのCookieをターゲットに渡す）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      
      // セーフサーチOFFの強制上書き
      let cookie = request.headers.get('Cookie') || '';
      if (!cookie.includes('ADLT=OFF')) {
        cookie += '; SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0';
      }
      newHeaders.set('Cookie', cookie);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 2. ログイン維持の鍵！レスポンスヘッダー（Cookie）の書き換え
      const newResponseHeaders = new Headers(response.headers);
      
      // サイトから送られてきた「Set-Cookie」を、自分のドメイン用としてブラウザに保存させる
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        // Cookieの有効範囲をターゲットドメインから「自分のWorkersドメイン」に書き換える
        const modifiedCookie = setCookie.replace(new RegExp(targetHost, 'g'), originHost);
        newResponseHeaders.set('set-cookie', modifiedCookie);
      }

      // 3. リダイレクトの書き換え
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

      // 4. HTML / JS のリンク書き換え
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // リンクと画像パスを自分経由に
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        body = body.replace(/(href|src|action)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

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
