# Proxy adapters

The core is proxy-agnostic. Everything that has to do with a route — the name it gets,
the registry that publishes the document, the CLI and the MCP server — knows nothing
about which proxy is in front of the machine. The trust list is about addresses, not
about the proxy: it says who may talk to the gateway. The core knows routes, ports,
host names and reachability, and asks an adapter for everything else.

The package ships with one adapter: the Traefik adapter. It reads the routes and the
configuration and renders the document Traefik polls, under the path `/traefik`. When
it is asked, it reads the API of the proxy to find out which proxy it is talking to.

The interface an adapter implements is small: an id, an optional address of the proxy's
API, three methods and one that is optional:

| What the adapter has | What it does |
| --- | --- |
| `id` | The name of the proxy. It is also the path the document is served under. |
| `defaultApiBaseUrl` | Where the API of the proxy usually answers. Optional. |
| `discover(options)` | Find the proxy, read its version and what it derives from its own configuration. |
| `render(routes, config)` | Render the document the proxy polls: the relay the requests go to, and the id of the route that the proxy stamps on the request. The port of the dev server is not in the document — the relay looks it up when the request arrives. |
| `wiringSnippet(config)` | The static configuration the user has to add to the proxy. |
| `verify(route, config)` | Whether the proxy already knows the route. Optional. |

An adapter for another proxy — Caddy, say — implements the `ProxyAdapter`
contract exported by `@malarstrom/gatewarden`. The bundled Traefik adapter is
one implementation of that contract.
The package does not load an adapter at run time. The `proxy` key of the configuration
file names one, and the daemon picks it from the adapters it is built with. An id it
does not know is a mistake in the configuration file, and the package says so: the
daemon stops instead of starting the worker again and again, `gatewarden start` answers
`unknown proxy "caddy" (known: traefik)` instead of a health check that never answers,
and `gatewarden doctor` reports the id as an error. A second adapter is therefore a
change in the package, not a setting in the configuration file.
