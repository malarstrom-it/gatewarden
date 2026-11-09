# Gatewarden and development preview alternatives

Gatewarden manages development routes through a proxy adapter and relays requests to local servers. Its core is **proxy-agnostic**: route registration, naming and agent-facing tools use an adapter contract. The current distribution ships a **Traefik adapter**. Supporting another proxy requires implementing an adapter and including it in the package; choosing a different configuration value does not install an adapter. [Adapter contract](https://github.com/malarstrom-it/gatewarden/blob/feat/npm-package/src/core/proxy.ts), [adapter catalog](https://github.com/malarstrom-it/gatewarden/blob/ade1308f67fa2df167804263f1d7de46471cd231/src/adapters/index.ts).

## Scope and method

This guide compares documented deployment models for sharing development services. It is intended to help you choose an architecture, rather than rank products. Documentation was reviewed on **9 November 2026**. Gatewarden observations refer to commit `ade1308f67fa2df167804263f1d7de46471cd231`; the linked upstream documentation may change.

The dimensions are the work each approach performs, the network path it requires, the infrastructure involved and how routes or endpoints are configured. These are architectural differences, not security scores. We did not benchmark performance, audit the alternatives, compare pricing or inventory every integration. A product's unmentioned feature should not be read as an absent feature. Gatewarden's CLI/MCP workflow is documented below; a comprehensive inventory of competitor agent integrations is outside scope.

## Three layers to distinguish

| Layer | Question it answers | Examples |
| --- | --- | --- |
| Development route orchestration | How does a running dev server get a named route, and how is that route removed? | Gatewarden; your own scripts or configuration workflow |
| Connectivity and tunnels | How do requests reach a service across network boundaries? | localtunnel, ngrok agent endpoints, Cloudflare Tunnel, frp; Tailscale provides a private network and service-sharing features |
| Reverse proxy and TLS serving | Which component accepts the browser request, applies routing policy and serves HTTPS? | Traefik, Caddy; managed services can also provide this layer |

A setup can combine layers. For example, Gatewarden can manage routes while a proxy is reached over an existing VPN. Gatewarden itself does not establish an outbound tunnel or create that network connectivity. With the shipped adapter, Traefik must reach both Gatewarden's registry and relay. [Gatewarden architecture and requirements](../README.md).

## Deployment comparison

The rows describe the named approach in the documented configuration, not every possible deployment of the product.

| Approach | Primary role | Path to the development service | Infrastructure and configuration ownership | Route or endpoint workflow | Sources |
| --- | --- | --- | --- | --- | --- |
| **Gatewarden with its shipped Traefik adapter** | Development route orchestration and localhost relay | Your Traefik instance reaches Gatewarden's registry and relay; the relay forwards to a registered local port | You operate the proxy, DNS/TLS setup and gateway; the core delegates proxy details to its adapter | Register/remove routes through CLI or MCP; addresses follow project and branch | [README](../README.md), [adapter contract](https://github.com/malarstrom-it/gatewarden/blob/feat/npm-package/src/core/proxy.ts) |
| **Traefik configured directly** | Reverse proxy and TLS serving | Traefik must reach the upstream specified in its service configuration | You operate Traefik and select its configuration provider | Supply routing configuration through a provider; the HTTP provider polls a configuration endpoint | [HTTP provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/others/http/), [overview](https://github.com/traefik/traefik#overview) |
| **Caddy configured directly** | Web server, reverse proxy and HTTPS serving | Caddy forwards to the configured upstream | You operate Caddy and configure its hostname/upstream | Configure with a Caddyfile or JSON; the administration API supports configuration updates | [Reverse proxy guide](https://caddyserver.com/docs/quick-starts/reverse-proxy), [administration API](https://caddyserver.com/docs/api) |
| **localtunnel** | Local-service tunneling | A client connects to a tunnel server and receives a shareable URL | Use the default service or operate a compatible server | Start a tunnel for a local port with the CLI or Node API; the client supports choosing the server | [Client README](https://github.com/localtunnel/localtunnel#readme), [server repository](https://github.com/localtunnel/server) |
| **ngrok agent endpoints** | Connectivity through ngrok Secure Tunnel agents | An agent connects to ngrok and forwards endpoint traffic to the service; documented for NAT scenarios | You run the agent; endpoints use ngrok's cloud service | Create agent endpoints through a CLI, SDK or Kubernetes operator; lifetime follows the connected agent process | [Agent endpoints](https://ngrok.com/docs/gateway/endpoints/agent-endpoints) |
| **Cloudflare Tunnel** | Origin-to-Cloudflare connectivity | `cloudflared` initiates outbound connections to Cloudflare; origin does not need a publicly routable IP | You run a connector and configure the tunnel in Cloudflare | Create a tunnel and configure its service connectivity through the documented management workflows | [Tunnel architecture](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/) |
| **frp** | Reverse-proxy connectivity across NAT/firewall boundaries | A client/server arrangement forwards to internal services; supports TCP, UDP, HTTP and HTTPS | You configure the frp client/server deployment | Configure proxies and domains for the services you want to expose | [Overview and architecture](https://github.com/fatedier/frp#what-is-frp) |
| **Tailscale Serve** | Share a local service within a tailnet | Requests arrive through the Tailscale network | You configure devices and access within a Tailscale tailnet | Configure the local target with `tailscale serve` | [Serve reference](https://tailscale.com/docs/reference/tailscale-cli/serve) |
| **Tailscale Funnel** | Public service sharing using Tailscale | Public traffic reaches a Funnel relay, with TLS termination on the device serving the local service | You configure Tailscale and Funnel permissions; Funnel uses tailnet `ts.net` names | Configure the local target with `tailscale funnel` | [Funnel architecture and limitations](https://tailscale.com/docs/features/tailscale-funnel) |

## Which setup fits your situation?

The following are recommendations inferred from the deployment models above.

| Situation | A useful starting point | Reason |
| --- | --- | --- |
| You already operate a proxy, DNS and TLS, and repeatedly publish different dev ports or branches | Gatewarden | It packages route registration, predictable names, route inspection and removal into a development workflow. Its architecture remains proxy-agnostic; the ready-to-use integration currently ships for Traefik. |
| You have one or a few stable upstreams and are comfortable maintaining their routes | Configure your proxy directly | A separate development route manager may add little value to this workflow. |
| A reviewer or webhook sender cannot reach your development network | Evaluate a tunnel or connectivity solution | This introduces a reachability requirement that Gatewarden does not provide by itself. Choose based on the intended audience and your deployment constraints. |
| You want to operate your own tunnel endpoints across NAT | Evaluate frp or a self-operated localtunnel server | These document server-side components you can operate. The protocol and deployment requirements differ. |
| Your team already works inside a tailnet and only tailnet users need access | Evaluate Tailscale Serve | Its documented audience is the tailnet. Funnel is a separate option for public sharing. |
| You want to add another reverse proxy to Gatewarden | Evaluate the `ProxyAdapter` contract | This is an adapter implementation and packaging task. It is not a runtime plugin installation or a configuration-only switch. |

## Security considerations for any option

Compare the complete deployed path: who can reach the service, where TLS terminates, how each hop is protected, who can change routes and how browser users authenticate. Network reachability, transport encryption and visitor authorization are separate properties.

For Gatewarden, an HTTPS browser address is served by the proxy; it does not assert end-to-end TLS through the relay. Its documented CIDR rules and optional shared secret govern access to the gateway listeners. Your proxy and network configuration determine the audience for the development URL. [Gatewarden configuration and trust model](../README.md#the-trust-list).

Self-operation is a choice about control and responsibility. It is not, by itself, evidence that a system is more secure. Likewise, a tunnel does not imply a hosted third party: localtunnel and frp have server components you can operate. A relay's presence does not establish where content is decrypted; Funnel, for example, documents TLS termination on the serving device. Use the architecture sources above when assessing a specific deployment.
