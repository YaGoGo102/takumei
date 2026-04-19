export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const targetHost = 'duckduckgo.com';

    // 404を防ぐため、ホスト名をDuckDuckGoに固定してリクエストを作成
    const targetUrl = new URL(request.url);
    targetUrl.hostname = targetHost;

    const newHeaders = new Headers(request.headers);
    newHeaders.set('Host', targetHost);
    newHeaders.set('Referer', `https://${targetHost}/`);

    try {
      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual'
      }));

      // リダイレクト処理
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

      // テキストデータのみ書き換え
      if (contentType.includes('text/html') || contentType.includes('text/css') || contentType.includes('javascript')) {
        let body = await response.text();
        body = body.replace(/duckduckgo\.com/g, originHost);

        const newResponseHeaders = new Headers(response.headers);
        newResponseHeaders.delete('content-security-policy');
        newResponseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(body, {
          status: response.status,
          headers: newResponseHeaders
        });
      }

      return response;

    } catch (e) {
      // エラーが起きた場合に404ではなくエラー内容を表示させる（デバッグ用）
      return new Response("Error: " + e.message, { status: 500 });
    }
  },
};
