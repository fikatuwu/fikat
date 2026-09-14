export default {
  async fetch(request, env) {
    try {
      const response = await env.ASSETS.fetch(request);
      if (response.status === 404) {
        const url = new URL(request.url);
        if (!url.pathname.includes('.')) {
          return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
        }
      }
      return response;
    } catch (err) {
      return new Response("Asset fetch error: " + err.message, { status: 500 });
    }
  }
};
