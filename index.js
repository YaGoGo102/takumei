export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値はBing
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      
      // 【重要】セーフサーチをオフにするための設定をCookieに仕込む
      // Bingの場合、ADLT=OFF がセーフサーチオフを意味します
      newHeaders.set('Cookie', 'SRCHHPGUSR=ADLT=OFF; PREF=SAFEUI=0');
      
      newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        redirect: 'manual'
      }));

      // --- 以下、前回の「全URL固定」の処理を継続 ---
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        let body = await response.text();

        // 全URLの書き換え
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // 相対パスの書き換え
        body = body.replace(/(href|src|action)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        const newResponseHeaders = new Headers(response.headers);
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
