export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const originHost = url.host;
    const proxyPrefix = "/proxy/";

    let targetUrlString = "";
    if (url.pathname.startsWith(proxyPrefix)) {
      targetUrlString = url.pathname.slice(proxyPrefix.length) + url.search;
    } else {
      // 初期値（好きなサイトに変更可能）
      targetUrlString = "https://www.bing.com" + url.pathname + url.search;
    }

    try {
      const targetUrl = new URL(targetUrlString);
      const targetHost = targetUrl.host;

      // 1. リクエストの構築（動画サイトはRefererとUser-Agentに厳しい）
      const newHeaders = new Headers(request.headers);
      newHeaders.set('Host', targetHost);
      newHeaders.set('Referer', `https://${targetHost}/`);
      newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      const response = await fetch(new Request(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: 'manual' 
      }));

      // 2. クッキーとリダイレクトの書き換え（前回の強化版を継承）
      const newResponseHeaders = new Headers(response.headers);
      const setCookies = response.headers.getSetCookie();
      newResponseHeaders.delete('set-cookie');
      for (let cookie of setCookies) {
        let modifiedCookie = cookie.replace(new RegExp(targetHost, 'g'), originHost);
        modifiedCookie = modifiedCookie.replace(/Domain=[^;]+;?/i, '');
        newResponseHeaders.append('set-cookie', modifiedCookie);
      }

      if ([301, 302, 307, 308].includes(response.status)) {
        let location = response.headers.get('Location');
        if (location) {
          const absoluteLoc = new URL(location, targetUrl.origin).href;
          newResponseHeaders.set('Location', `https://${originHost}${proxyPrefix}${absoluteLoc}`);
        }
      }

      // 3. 動画再生を邪魔する制限（CSPやX-Frame-Options）を徹底的に消去
      newResponseHeaders.delete('content-security-policy');
      newResponseHeaders.delete('content-security-policy-report-only');
      newResponseHeaders.delete('x-frame-options');
      newResponseHeaders.delete('x-content-type-options');
      // ブラウザに「これは安全だよ」と教え込む
      newResponseHeaders.set('Access-Control-Allow-Origin', '*');
      newResponseHeaders.set('Access-Control-Allow-Credentials', 'true');

      const contentType = response.headers.get('content-type') || '';

      // 4. HTML / JS の置換処理
      if (contentType.includes('text') || contentType.includes('javascript')) {
        let body = await response.text();

        // あらゆるURLをTakumeiドメイン経由に
        body = body.replace(/https?:\/\/([a-zA-Z0-9.-]+\.[a-z]{2,})/g, (match) => {
          if (match.includes(originHost)) return match;
          return `https://${originHost}${proxyPrefix}${match}`;
        });

        // 相対パスの固定
        body = body.replace(/(href|src|action|data-url)="\/(?!\/)/g, `$1="https://${originHost}${proxyPrefix}${targetUrl.origin}/`);

        return new Response(body, { status: response.status, headers: newResponseHeaders });
      }

      // 画像や動画ファイルなどはそのまま返す
      return response;

    } catch (e) {
      return new Response("中継エラー: " + e.message, { status: 500 });
    }
  }
};
