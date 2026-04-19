export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const targetHost = 'duckduckgo.com';

    // すべてのリクエストをDuckDuckGoへ向ける
    url.hostname = targetHost;

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetHost);
    newHeaders.set('Referer', `https://${targetHost}/`);
    newHeaders.set('User-Agent', request.headers.get('User-Agent'));

    const response = await fetch(new Request(url, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: 'manual'
    }));

    // リダイレクト（検索後の移動）を自分のドメインに書き換え
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('Location');
      if (location) {
        return new Response(null, {
          status: response.status,
          headers: { 'Location': location.replace(/duckduckgo\.com/g, originHost) }
        });
      }
    }

    const contentType = response.headers.get('content-type') || '';

    // HTML、CSS、JavaScript の中身だけを書き換える
    if (
      contentType.includes('text/html') || 
      contentType.includes('text/css') || 
      contentType.includes('javascript')
    ) {
      let body = await response.text();
      
      // ページ内の DuckDuckGo へのリンクをすべて自分のドメインに変える
      body = body.replace(/duckduckgo\.com/g, originHost);
      
      const newResponseHeaders = new Headers(response.headers);
      // セキュリティ制限（CSP）を削除してデザインを表示させる
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('content-security-policy-report-only');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(body, {
        status: response.status,
        headers: newResponseHeaders
      });
    }

    // 画像やフォント、アイコンなどのバイナリデータはそのまま通す
    return response;
  },
};
