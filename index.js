export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 日本語のBing検索結果をデフォルトにする設定
      targetUrlString = "https://www.bing.com/?setlang=ja&cc=JP";
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 1. リクエストヘッダーの高度な偽装（日本からのアクセスを装う）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', targetUrl.origin);
      // 言語設定を日本語優先に固定
      newHeaders.set('Accept-Language', 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7');
      
      // セーフサーチOFF & 日本地域固定のCookieを注入
      let cookie = request.headers.get('Cookie') || '';
      const geoCookies = 'SRCHHPGUSR=ADLT=OFF&NRSLT=50; _EDGE_V=1; MUID=1; SRCHUSR=DOB=20240101; _SS=SID=1&HV=1;';
      newHeaders.set('Cookie', cookie ? `${cookie}; ${geoCookies}` : geoCookies);

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 2. ログイン維持のためのCookieドメイン変換（SNS対応）
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      
      for (let c of setCookies) {
        // 全てのサイトのCookieをTakumeiドメインに紐付け直す
        let modified = c.replace(new RegExp(targetHost, 'g'), originHost)
                        .replace(/Domain=[^;]+;?/i, '')
                        .replace(/SameSite=Lax|SameSite=Strict/i, 'SameSite=None; Secure'); 
        newResponseHeaders.append('set-cookie', modified);
      }

      // セキュリティ制限（ログインを阻む壁）を削除
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', `https://${originHost}`);
      newResponseHeaders.set('Access-Control-Allow-Credentials', 'true');

      if (!response.headers.get('content-type')?.includes('text/html')) {
        return new Response(response.body, { status: response.status, headers: newResponseHeaders });
      }

      // 3. HTMLRewriterでリンクとスクリプトを「Takumeiドメイン」に監禁
      const rewriter = new HTMLRewriter()
        .on('a, img, script, video, source, form, iframe', {
          element(el) {
            const attr = el.tagName === 'form' ? 'action' : (el.hasAttribute('href') ? 'href' : 'src');
            let val = el.getAttribute(attr);
            if (val && !val.startsWith('data:') && !val.startsWith('#') && !val.includes(originHost)) {
              try {
                const absolute = new URL(val, targetUrl.origin).href;
                el.setAttribute(attr, `https://${originHost}${proxyPrefix}${absolute}`);
              } catch(e) {}
            }
          }
        });

      return rewriter.transform(new Response(response.body, { status: response.status, headers: newResponseHeaders }));

    } catch (e) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  }
};
