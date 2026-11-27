# Community service on local Floci

Deploys the community service (fees, payments, announcements) as its own
Lambda behind its own API Gateway on a local Floci. It follows the same
structure as `infra/maintenance`.

## Resources

| Resource | Name |
| --- | --- |
| Lambda | `compound-community` (`nodejs24.x`, handler `src/lambda.handler`, 30 s, 512 MB) |
| Execution role | `compound-community-lambda-role` (trusts `lambda.amazonaws.com` only) |
| Inline policy | `compound-community-runtime` (see `runtime-policy.json`) |
| Log group | `/aws/lambda/compound-community`, 14-day retention |
| REST API | `compound-community-api`, stage `dev`, `{proxy+}` ANY → Lambda proxy |

The role has no DynamoDB, Lambda or IAM permissions. It can only create log
streams and write log events in its own log group. Community never reads the
identity session tables. It calls the maintenance identity API over HTTP
through the maintenance API Gateway.

## Prerequisites

- Floci on `http://127.0.0.1:4566`, joined to `compound-network` under the
  hostname `floci`, and an AWS CLI profile `floci`.
- Maintenance deployed with `infra/maintenance`, so that
  `.deployment/maintenance-api-id.txt` exists.
- `services/community/.env` with:
  - `DATABASE_URL`, connecting as the `community_app` role;
  - `AUTH_SERVICE_KEY`;
  - optionally `MAINTENANCE_AUTH_KEY`. Without it, the internal drafts
    endpoint answers 503.

  The file is read locally and its values never leave `.deployment/`.

## Commands (PowerShell, from the repository root)

```powershell
./infra/community/provision-foundation.ps1   # role, inline policy, log group
./infra/community/deploy-lambda.ps1          # environment, package, create/update Lambda, health
node ./infra/community/configure-gateway.mjs # API Gateway, invoke permission, deploy, health
./infra/community/update.ps1                 # code-only redeploy plus health checks
```

`package.ps1` builds `.deployment/community-linux.zip` from production
dependencies only. It writes forward-slash ZIP paths and refuses to include
`.env` files, tests or scripts.

Inside Lambda, `IDENTITY_BASE_URL` points at
`http://floci:4566/restapis/<maintenance-api-id>/dev/_user_request_`. Set
`FLOCI_LAMBDA_ENDPOINT` before `deploy-lambda.ps1` to use another host.

`.deployment/` is git-ignored. It holds the private environment file, the
package and the API ids.

## Frontend through the gateways

`frontend/vite.config.js` reads these optional variables from the git-ignored
`frontend/.env`:

```
MAINTENANCE_PROXY_TARGET=http://127.0.0.1:4566
MAINTENANCE_PROXY_PREFIX=/restapis/<maintenance-api-id>/dev/_user_request_/api/v1
COMMUNITY_PROXY_TARGET=http://127.0.0.1:4566
COMMUNITY_PROXY_PREFIX=/restapis/<community-api-id>/dev/_user_request_/api/v1
```

Without them, the proxies use the local Express services on ports 3001 and
3003.

## Known Floci behaviour

With IAM enforcement on, this Floci build evaluates `logs:PutLogEvents`
against `resource=*`, as its enforcement log shows. A role scoped to its own
log group is therefore denied `PutLogEvents`, and the maintenance role is
denied too. The policy keeps the scoped ARN that is correct on AWS; it is
not widened to `*` to work around the emulator.

Floci does not forward Lambda stdout to CloudWatch Logs either: the
per-invocation log streams are created empty. Log-write enforcement is
therefore not verified on Floci.
