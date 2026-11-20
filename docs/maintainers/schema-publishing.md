# Schema publishing

This guide explains how the JSON Schemas are published to
`https://schemas.projections.githubnext.com/` and what infrastructure needs to
be provisioned before the first release goes out. See
[Versioning and publishing](../contracts.md#versioning-and-publishing) for the
URL structure and compatibility policy.

## How a release publishes

`.github/workflows/publish-schemas.yml` runs as a dist post-announce job (listed
under `post-announce-jobs` in `dist-workspace.toml`), right after the release
workflow announces a release. You can also run it manually from the Actions tab
— useful for republishing or for the initial publish right after provisioning —
by choosing the release tag under **Use workflow from** and passing it as `tag`.

The workflow runs three steps:

1. **Validate the committed schemas.** It runs
   `node packages/schemas/scripts/publication.mjs` (the same check `npm test`
   runs) to verify every `$id` and `$ref` points to the schemas host, every
   reference resolves, and the committed files match what the TypeBox sources
   generate.
2. **Upload immutable snapshots.** Each schema is uploaded to
   `<name>/v<major>/<release>.json` with a one-year immutable cache header.
   Snapshots are never overwritten — if a snapshot already exists with different
   content, the job fails.
3. **Update the rolling major-version files.** For stable releases (any version
   without a prerelease suffix, such as `0.2.0`), it updates each
   `<name>/v<major>.json` with a five-minute cache header. Prereleases like
   `0.3.0-beta.1` only write snapshots.

The workflow never deletes blobs. Until the repository variables below are
configured, it simply logs a notice and exits cleanly.

## Provision

### Azure

1. **Storage account.** Create a StorageV2 account (`Standard_LRS` is plenty)
   with
   [static website](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)
   hosting enabled. Releases upload to its `$web` container. Because a static
   website endpoint serves files anonymously even when public blob access is
   disabled, keep **Allow Blob anonymous access** off and disable shared key
   access.
2. **Front Door (Standard).** Create a profile and endpoint whose origin is the
   storage account's static website host
   (`<account>.z<N>.web.core.windows.net`), using HTTPS only. Enable caching
   with **Use origin cache-control headers** so each blob's `Cache-Control`
   header takes effect. Add a rule set on the route that overwrites these
   response headers:
   - `Access-Control-Allow-Origin: *`
   - `Cross-Origin-Resource-Policy: cross-origin`
   - `X-Content-Type-Options: nosniff`

   Content types come straight from the blobs (`application/schema+json`).

3. **Custom domain.** Attach `schemas.projections.githubnext.com` to the
   endpoint with a Front Door managed certificate.
4. **Publishing identity.** Create a Microsoft Entra app registration (or
   user-assigned managed identity) with a federated credential for GitHub
   Actions using issuer `https://token.actions.githubusercontent.com`, subject
   `repo:<owner>/<repository>:environment:schemas`, and audience
   `api://AzureADTokenExchange`. Assign it **Storage Blob Data Contributor** on
   the storage account (or scoped to its `$web` container). No secrets are
   stored; the workflow authenticates via OpenID Connect.

### DNS

- Add a `CNAME schemas.projections.githubnext.com` record pointing to the Front
  Door endpoint host (`<endpoint>-<hash>.z01.azurefd.net`).
- Add the `TXT _dnsauth.schemas.projections.githubnext.com` record that Front
  Door provides to validate domain ownership.

### GitHub

1. Create an environment named `schemas` and restrict its deployments to release
   tags (selected tags such as `v*`) so only releases can publish.
2. Add the following repository variables under Settings → Secrets and variables
   → Actions → Variables (none of these are secrets):

   | Variable                        | Value                                      |
   | ------------------------------- | ------------------------------------------ |
   | `SCHEMAS_AZURE_CLIENT_ID`       | The publishing identity's client ID        |
   | `SCHEMAS_AZURE_TENANT_ID`       | Its tenant ID                              |
   | `SCHEMAS_AZURE_SUBSCRIPTION_ID` | The storage account's subscription         |
   | `SCHEMAS_STORAGE_ACCOUNT`       | The storage account name                   |
   | `SCHEMAS_STORAGE_CONTAINER`     | Optional: the container, `$web` by default |

## Verify

Once provisioning is done, trigger **Publish schemas** with the latest release
tag, then check the live response headers:

```sh
curl -sI -H 'Origin: https://vscode.dev' https://schemas.projections.githubnext.com/extraction/v0.json
```

You should see status `200`, `content-type: application/schema+json`,
`access-control-allow-origin: *`, and `cache-control: public, max-age=300`.
Checking a versioned snapshot such as `…/extraction/v0/0.2.0.json` should return
`cache-control: public, max-age=31536000, immutable`.
