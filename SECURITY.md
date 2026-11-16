# Security policy

## Supported versions

Only the latest release of `getodds-mcp` gets security fixes. Upgrade before reporting.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately in either way:

- GitHub: the **Report a vulnerability** button on this repository's Security tab
  (https://github.com/getoddsapi/getodds-mcp/security/advisories/new)
- Email: ops@getoddsapi.com

Include the version, your MCP client, steps to reproduce and the impact you expect. We reply within 3 business
days and tell you when a fix ships.

## Scope

This package is a local stdio MCP server. It reads `GETODDS_API_KEY` from its environment and sends it only to
https://getoddsapi.com (or a base URL you override). Reports about key handling, request forwarding, or output that
could inject instructions into an MCP client are in scope. Problems with the hosted API at getoddsapi.com are also
welcome at the same address.
