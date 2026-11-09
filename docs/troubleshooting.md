# Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `gatewarden register` says `no DNS zone is configured` | The configuration file has no `zone` | Write the zone into the configuration file (`"zone": "example.com"`) and register again |
| The address answers `502` | The dev server does not listen on the port you registered | Look at it with `gatewarden list`. The state column says `up` or `down` |
| The address answers `404` at the proxy | The proxy has not picked the route up yet, or the wiring is not in place | Wait one poll interval. Then check that the `http` provider is in the static configuration of the proxy, and that the proxy was restarted after it was added |
| The relay answers `403` | Two causes. The address of the proxy is not in `allowedCidrs`. Or the installation has a `secret` and the request did not present it: the relay takes the secret in `X-Relay-Secret` | Add the address of the proxy to `allowedCidrs` in the configuration file, and restart the daemon. If the installation has a `secret`, let the proxy send it in `X-Relay-Secret`. The answer says which address was refused, or that the secret is missing or wrong |
| The registry answers `403` | Two causes. The address that asks for the configuration document is not in the trust list — the list of the relay (`allowedCidrs`) and, on top of it, the list of the registry (`registryAllowedCidrs`). Or the installation has a `secret` and the poll did not present it: the registry takes the secret in `X-Registry-Secret` | Add the address to `allowedCidrs` or to `registryAllowedCidrs`, and restart the daemon. If the installation has a `secret`, let the proxy send it in `X-Registry-Secret` when it polls the document. The answer says which address was refused, or that the secret is missing or wrong |
| The registry answers `403`, the relay answers `200` | Two causes. The registry has two lists — the list of the relay (`allowedCidrs`) and, on top of it, the list of the registry (`registryAllowedCidrs`) — and the address that polls the registry is in neither of them. The two listeners are then reached from different addresses: the relay sees the one that is in its own list. Or the installation has a `secret` and the poll did not present it, or presented the wrong value: the relay takes the secret in `X-Relay-Secret` and the registry in `X-Registry-Secret`, so a proxy that presents it to the relay but not to the registry gets `403` here | Add the address that polls the registry to `allowedCidrs` or to `registryAllowedCidrs` in the configuration file, and restart the daemon. If the installation has a `secret`, let the proxy send it in `X-Registry-Secret` when it polls the document. The answer says which address was refused, or that the secret is missing or wrong |
| The certificate of the address is not trusted | The resolver was not asked for a wildcard of the project, or the zone is another one | Look at the resolver in the log of the proxy. `"tlsMode": "fqdn"` asks for one certificate per address instead of one per project |
| The host name does not resolve | The DNS zone has no wildcard record for the subdomains | Add a `*` record for the zone to your DNS |
| `gatewarden doctor` says `not running` | The daemon is not up | Run `gatewarden start`, and read the log file the command names |
| The proxy serves its dashboard instead of your dev server | The route is not in the document the proxy polls | Run `curl -sS http://127.0.0.1:45002/traefik`. The route has to be in it |

`gatewarden doctor` reports every check it made: the configuration file, the state
directory, the daemon, the two ports, the routes, the proxy and the service unit.
It exits 1 on a failed check. What each check means is in
[healthcheck guide](healthcheck.md). The skill's
[troubleshooting reference](../skills/gatewarden/references/troubleshooting.md) lists
more failures.
