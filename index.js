export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const targetHost = 'duckduckgo.com';

    // 404を避けるため、リクエスト先のURLをDuckDuckGoのものに完全に作り直す
    const targetUrl = new URL(request.url);
    targetUrl.hostname = targetHost;
    targetUrl.protocol = 'https:';

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetHost);
    newHeaders.set('Referer', `https://${targetHost}/`);
    // ブラウザのふりをして拒否を防ぐ
    newHeaders.set('User-Agent', request.headers.get('User-Agent'));

    try {
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // リダイレクト（検索後の移動）が発生した場合の処理
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers.get('Location');
        if (location) {
          const newLocation = location.replace(/duckduckgo\.com/g, originHost);
          return new Response(null, {
            status: response.status,
            headers: { 'Location': newLocation }
          });
        }
      }

      const contentType = response.headers.get('content-type') || '';

      // HTML、CSS、JSの中身を書き換えて自分のドメインを維持する
      if (contentType.includes('text/html') || contentType.includes('text/css') || contentType.includes('javascript')) {
        let body = await response.text();
        
        // ページ内のすべてのDuckDuckGoドメインを自分のWorkersドメインに置換
        body = body.replace(/duckduckgo\.com/g, originHost);

        const newResponseHeaders = new Headers(response.headers);
        // セキュリティ制限（CSP）を削除して、デザインや画像が表示されるようにする
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.delete('x-frame-options');
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(body, {
          status: response.status,
          headers: newResponseHeaders
        });
      }

      // 画像などのバイナリデータは、加工せずにそのままブラウザへ流す
      return response;

    } catch (e) {
      // 万が一エラーが起きた場合に、原因を画面に表示させる
      return new Response("Workers中継エラー: " + e.message, { status: 500 });
    }
  },
};
