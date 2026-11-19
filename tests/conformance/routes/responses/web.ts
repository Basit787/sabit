export const GET = () =>
  new Response("<h1>hi</h1>", {
    status: 202,
    headers: { "content-type": "text/html; charset=utf-8", "x-custom": "web" },
  });
