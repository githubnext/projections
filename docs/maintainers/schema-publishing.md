# Schema publishing

How the JSON Schemas reach `https://schemas.projections.githubnext.com/`, and
what to provision before the first release publishes them.
[Versioning and publishing](../contracts.md#versioning-and-publishing) describes
the URLs and the compatibility policy.

## How a release publishes

`.github/workflows/publish-schemas.yml` runs as a dist post-announce job
(`post-announce-jobs` in `dist-workspace.toml`), after the release workflow
announces a release. You can also run it by hand from the Actions tab, to
publish a release again or for the first time after provisioning: choose the
release tag under **Use workflow from**, and enter it as `tag`. It:

1. checks the committed schemas form a complete set
   (`node packages/schemas/scripts/publication.mjs`, which `npm test` also
   runs): every `$id` and `$ref` uses the schemas host, every reference
   resolves, and the set is exactly what the TypeBox sources generate;
2. uploads each schema's snapshot, `<name>/v<major>/<release>.json`, cached for
   a year as immutable. A snapshot is never replaced: if it already exists with
   other content, the job fails;
3. for a stable release (any version without a prerelease suffix, such as
   `0.2.0`), replaces each `<name>/v<major>.json`, cached for five minutes. A
   prerelease such as `0.3.0-beta.1` writes snapshots only.

It never deletes a blob. Until the variables below are set, the job only adds a
notice to the run.

## Provision

### Azure

1. **Storage account** (StorageV2, `Standard_LRS` is enough) with the
   [static website](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)
   enabled. The release uploads to its `$web` container. A static website serves
   anonymously at its web endpoint even when public blob access is off, so leave
   **Allow Blob anonymous access** off and shared key access disabled.
2. **Front Door** (Standard) profile with an endpoint whose origin is the
   storage account's static website host
   (`<account>.z<N>.web.core.windows.net`), HTTPS only, and caching enabled with
   **Use origin cache-control headers** so the blobs' `Cache-Control` applies.
   Add a rule set on the route with these response headers (overwrite):
   - `Access-Control-Allow-Origin: *`
   - `Cross-Origin-Resource-Policy: cross-origin`
   - `X-Content-Type-Options: nosniff`

   Content types come from the blobs (`application/schema+json`).

3. **Custom domain** `schemas.projections.githubnext.com` on the endpoint, with
   a Front Door managed certificate.
4. **Publishing identity**: a Microsoft Entra app registration (or user-assigned
   managed identity) with a federated credential for GitHub Actions: issuer
   `https://token.actions.githubusercontent.com`, subject
   `repo:<owner>/<repository>:environment:schemas`, audience
   `api://AzureADTokenExchange`. Grant it **Storage Blob Data Contributor** on
   the storage account (or just its `$web` container). No secret is stored: the
   workflow signs in with OpenID Connect.

### DNS

- `CNAME schemas.projections.githubnext.com` → the Front Door endpoint host
  (`<endpoint>-<hash>.z01.azurefd.net`).
- The `TXT _dnsauth.schemas.projections.githubnext.com` record Front Door shows
  to validate the custom domain.

### GitHub

1. Create the `schemas` environment. Restrict its deployments to release tags
   (selected tags, such as `v*`) so only a release can publish.
2. Set these repository variables (Settings → Secrets and variables → Actions →
   Variables). They aren't secrets.

   | Variable                        | Value                                      |
   | ------------------------------- | ------------------------------------------ |
   | `SCHEMAS_AZURE_CLIENT_ID`       | The publishing identity's client ID        |
   | `SCHEMAS_AZURE_TENANT_ID`       | Its tenant ID                              |
   | `SCHEMAS_AZURE_SUBSCRIPTION_ID` | The storage account's subscription         |
   | `SCHEMAS_STORAGE_ACCOUNT`       | The storage account name                   |
   | `SCHEMAS_STORAGE_CONTAINER`     | Optional: the container, `$web` by default |

## Verify

After provisioning, run **Publish schemas** with the latest release tag, then:

```sh
curl -sI -H 'Origin: https://vscode.dev' https://schemas.projections.githubnext.com/extraction/v0.json
```

Expect `200`, `content-type: application/schema+json`,
`access-control-allow-origin: *` and `cache-control: public, max-age=300`. The
snapshot, such as `…/extraction/v0/0.2.0.json`, should have
`cache-control: public, max-age=31536000, immutable`.
