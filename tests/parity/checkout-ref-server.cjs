/* The ORIGINAL store for the checkout parity journeys: /home/claude/tools/ref-server.js (the
   original _site + its real handlers over tests/_world.js), plus three helper routes the
   journeys need, answered before the original server sees the request:

     POST /__ref/pay?ref=LM-…     the shopper pays on the (stubbed) Thawani page: __W.pay(ref)
     GET  /__ref/orders           the orders the original till stored (W.db.orders)
     POST /__ref/reset            empty the orders and the Thawani sessions between journeys

   node tests/parity/checkout-ref-server.cjs <port>     (REF_SERVER=… to point elsewhere) */
const http = require("http");
const path = require("path");

const real = http.createServer;
http.createServer = function (handler) {
  return real.call(http, function (req, res) {
    const u = new URL(req.url, "http://x");
    const W = global.__W;
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (u.pathname === "/__ref/pay") {
      try {
        W.pay(u.searchParams.get("ref"));
        return send(200, { ok: true });
      } catch (e) {
        return send(409, { ok: false, error: String(e.message) });
      }
    }
    if (u.pathname === "/__ref/orders") return send(200, W.db.orders);
    if (u.pathname === "/__ref/reset") {
      W.db.orders.length = 0;
      W.db.events.length = 0;
      W.thawani.sessions.length = 0;
      W.thawani.payments.length = 0;
      /* the rate limiter's counters (ops rl:<bucket>:<ip>): every journey comes from one IP */
      for (let i = W.db.ops.length - 1; i >= 0; i--) if (/^rl[:_]/.test(String(W.db.ops[i].key))) W.db.ops.splice(i, 1);
      return send(200, { ok: true });
    }
    return handler(req, res);
  });
};

require(process.env.REF_SERVER || path.join("/home/claude/tools", "ref-server.js"));
