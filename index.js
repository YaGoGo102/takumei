export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 日本語(ja)、日本地域(JP)、セーフサーチOFF(off)をURLに直接埋め込む
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP&adlt=off";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', "https://" + targetHost + "/");
      newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // ブラウザの言語設定を「日本語のみ」に固定して送信
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9');

      // 日本地域を強制するクッキーを偽造して追加
      let originalCookie = request.headers.get('Cookie') || '';
      let geoCookies = 'SRCHHPGUSR=ADLT=OFF&NRSLT=50; _EDGE_V=1; MUID=1; SRCHUSR=DOB=20240101; _SS=SID=1&HV=1;';
      newHeaders.set('Cookie', originalCookie + (originalCookie ? '; ' : '') + geoCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost)
                                   .replace(/Domain=[^;]+;?/i, '')
                                   .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', "https://" + originHost + proxyPrefix + absoluteLoc);
        }
      }

      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('text/html') || contentType.includes('javascript')) {
        let body = await response.text();

        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return "https://" + originHost + proxyPrefix + match;
        });

        body = body.replace(/(href|src|action|data-url)="\/(?!\/)/g, "$1=\"https://" + originHost + proxyPrefix + targetUrl.origin + "/");

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      return response;

    } catch (e) {
      return new Response("中継エラー: " + e.message, { status: 500 });
    }
  }
};
