export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;

    // 1. ターゲットの決定
    // URLのパラメータに「target」があればそれを使う、なければデフォルトをDuckDuckGoにする
    let targetUrlString = url.searchParams.get('__target');
    
    if (!targetUrlString) {
      // パラメータがない場合はDuckDuckGoへ
      targetUrlString = `https://duckduckgo.com${url.pathname}${url.search}`;
    }

    const targetUrl = new URL(targetUrlString);
    const targetHost = targetUrl.host;

    // 2. リクエストの準備
    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetHost);
    newHeaders.set('Referer', `https://${targetHost}/`);
    newHeaders.set('User-Agent', request.headers.get('User-Agent') || 'Mozilla/5.0');

    try {
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // 3. リダイレクトの書き換え
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const newLoc = new URL(location);
          return new Response(null, {
            status: response.status,
            headers: { 'Location': `https://${originHost}${newLoc.pathname}${newLoc.search}${newLoc.search ? '&' : '?'}__target=${encodeURIComponent(newLoc.origin + newLoc.pathname + newLoc.search)}` }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // 4. HTML内のリンクを「自分のURL + ターゲット指定」に書き換える
      if (contentType.includes('text/html')) {
        let body = await response.text();
        
        // リンクを書き換えて、クリックしても自分のWorkersに戻ってくるようにする
        // 仕組み：href="https://site.com" -> href="?__target=https://site.com"
        body = body.replace(/href="https?:\/\/([^"]+)"/g, (match, p1) => {
          const fullUrl = match.match(/https?:\/\/[^"]+/)[0];
          return `href="?__target=${encodeURIComponent(fullUrl)}"`;
        });

        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');

        return new Response(body, {
          status: response.status,
          headers: newResponseHeaders
        });
      }

      return response;

    } catch (e) {
      return new Response("閲覧エラー: " + e.message, { status: 500 });
    }
  }
};
