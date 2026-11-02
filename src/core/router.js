/**
 * Automated HTTP Request Router & Middleware Pipeline
 * Provides automated route registration, parameter extraction,
 * middleware execution, route introspection, and standardized error handling.
 */

export class Router {
  constructor() {
    this.routes = [];
    this.globalMiddlewares = [];
  }

  use(middleware) {
    if (typeof middleware === "function") {
      this.globalMiddlewares.push(middleware);
    }
    return this;
  }

  add(method, pathPattern, ...handlers) {
    const handler = handlers.pop();
    const middlewares = handlers;
    
    // Parse route pattern: e.g. "/api/admin/payments/:id/approve"
    const paramNames = [];
    const regexPattern = pathPattern
      .replace(/\/+$/, "")
      .replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      });

    const regex = new RegExp(`^${regexPattern || "/"}$`);

    this.routes.push({
      method: method.toUpperCase(),
      pattern: pathPattern,
      regex,
      paramNames,
      middlewares,
      handler
    });
    return this;
  }

  get(path, ...handlers) {
    return this.add("GET", path, ...handlers);
  }

  post(path, ...handlers) {
    return this.add("POST", path, ...handlers);
  }

  patch(path, ...handlers) {
    return this.add("PATCH", path, ...handlers);
  }

  delete(path, ...handlers) {
    return this.add("DELETE", path, ...handlers);
  }

  all(path, ...handlers) {
    return this.add("*", path, ...handlers);
  }

  getRegisteredRoutes() {
    return this.routes.map((r) => ({
      method: r.method,
      path: r.pattern
    }));
  }

  async handle(request, env, ctx = {}) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    // Context passed along the middleware chain
    const reqContext = {
      request,
      env,
      url,
      params: {},
      ctx
    };

    // Run global middlewares
    for (const mw of this.globalMiddlewares) {
      const response = await mw(reqContext);
      if (response instanceof Response) {
        return response;
      }
    }

    // Match route
    for (const route of this.routes) {
      if (route.method !== "*" && route.method !== method) continue;

      const match = pathname.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        reqContext.params = params;

        // Run route middlewares
        for (const mw of route.middlewares) {
          const mwRes = await mw(reqContext);
          if (mwRes instanceof Response) return mwRes;
        }

        // Execute main handler
        return await route.handler(reqContext);
      }
    }

    // Default 404 JSON response
    return Response.json({ ok: false, error: "not_found", path: pathname }, {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}
