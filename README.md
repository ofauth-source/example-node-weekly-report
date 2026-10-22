# OFAuth weekly earnings report

Create a seven-day UTC report from OFAuth earnings timeseries and paginated transactions. The program makes read requests only. It writes the report to stdout and retains the underlying transactions in `weekly-transactions.json`.

## Run the report

Use Node.js 22 or later and npm. Obtain an OFAuth access token with `finances:read` and a linked account granted to that authorization.

```bash
git clone https://github.com/ofauth-source/example-node-weekly-report.git
cd example-node-weekly-report
npm ci
cp .env.example .env
```

Edit `.env`. Set `ACCESS_TOKEN` and `LINKED_ACCOUNT_ID` to your authorized values. Keep `.env` out of version control.

For an interactive run, pass the first date of your reporting week:

```bash
npm start -- 2026-10-05
```

To save clean JSON, call Node directly. npm prints script headers to stdout, which would otherwise appear in the report file:

```bash
node --env-file=.env weekly-report.js 2026-10-05 > weekly-report.json
```

The date must use `YYYY-MM-DD`. This example covers October 5 through October 11, inclusive: `2026-10-05T00:00:00.000Z` up to, but excluding, `2026-10-12T00:00:00.000Z`.

A successful run creates two files:

- `weekly-report.json` contains the UTC bounds, currency, transaction count, amounts grouped by type and status, and the separate earnings trend.
- `weekly-transactions.json` contains the deduplicated transaction records used in the report, including IDs and nullable user information.

Check that the command exits successfully before using the output. An empty week has `transactionCount: 0` and an empty `byTypeAndStatus` array. API errors, invalid dates, unexpected currencies, and pagination that does not advance stop the program with an error on stderr.

## Read the results

`byTypeAndStatus` preserves the returned status, including `null`, and includes all returned statuses. It does not classify payments as settled or available for payout. Gross, fee, VAT, tax, and net remain separate. Transaction amounts use USD major units: `12.50` means $12.50. The program sums integer cents internally and outputs dollars. It rejects transactions with another currency.

`earnings.reportedTotal` comes from the API's total metric. `earnings.amountPoints` maps `chartAmount[].count` to each point's `amount`. These metrics remain separate from the transaction aggregates; do not add them together or assume their inclusion rules match.

The transaction endpoint has no `endDate` parameter. The program follows every page with the same `startDate`, filters `createdAt` to the reporting week, and deduplicates records by `id`.

## Handle financial data

Each run replaces `weekly-transactions.json`; shell redirection also replaces `weekly-report.json`. Use a separate working directory for each report you want to keep. Both output files contain financial data and are ignored by Git. Store them with appropriate access controls and retention rules.

Keep the token on your backend. If access expires or the account needs recovery, resolve that condition and rerun the report. This example does not refresh tokens or retry failed requests. It is a reporting example, not an accounting ledger or a payout reconciliation system.

## OAuth ownership and recovery

Use the [Express OAuth example](https://github.com/ofauth-source/example-express-oauth) for client registration, a session-bound callback with S256 PKCE, ordinary token persistence, paginated account discovery, explicit account selection, provider reconnect, and RFC 7009 revocation. Sandbox, Test, and Live use the same standard confidential OAuth flow.

Your auth framework or application owns the tokens. Access tokens are opaque and initially last 15 minutes; use the returned `expires_in`. Refresh tokens remain stable and expire after 90 days without authenticated refresh. Separate instances can refresh concurrently, and a lost refresh response can be retried with the same token. No mandatory database refresh lock or attempt journal is needed. Protect registration changes with conditional writes.

A provider session error requires reconnect for that exact linked account. OAuth refresh cannot repair it. Revoking a refresh token ends that credential and its access tokens; ending the authorization ends every credential. Never automatically repeat an interrupted provider write. Developer requests use the application's Developer entitlement; the account owner's Operator plan is independent.
