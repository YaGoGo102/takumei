export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    
    // 表示したいサイトのドメインをここに固定する
    // 例: 'discord.com' や 'wikipedia.org'
    const targetHost = 'discord.com'; 

    // ブラウザからのリクエストをターゲットドメインに書き換え
    const targetUrl = new URL(url.pathname + url.search, `https://${targetHost}`);

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetHost);
    newHeaders.set('Referer', `https://${targetHost}/`);
    // 拒否されないよう、一般的なブラウザのUser-Agentをセット
    newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // リダイレクトが発生した際のURL書き換え
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          return new Response(null, {
            status: response.status,
            headers: { 'Location': location.replace(new RegExp(`https?://${targetHost}`, 'g'), `https://${originHost}`) }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // HTML/CSS/JSの中にあるターゲットドメインを自分のドメインに全て置換
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();
        
        // 文字列置換で「discord.com」を「あなたのWorkersのURL」に変える
        const re = new RegExp(targetHost, 'g');
        body = body.replace(re, originHost);

        const newResponseHeaders = new Headers(response.headers);
        // セキュリティ制限を解除
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
      return new Response("Proxy Error: " + e.message, { status: 500 });
    }
  }
};
