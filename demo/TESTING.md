# Public test scope

The public API test suite contains synthetic fixtures for authentication, CSRF, role separation, source visibility, aggregate counting, geography, request validation, migrations and import contracts. It runs with `npm test --prefix platform/api`.

The development team also maintains checks against customer-authorized historical workbooks and original documents. Those documents and checks whose only fixture is a private data export are not distributed. Their removal does not mean those datasets were public, unavailable in the deployed service, or validated by this repository's CI.

The public repository retains optional database integration tests. Without an explicitly configured isolated integration database, they are skipped. Original-document tests are skipped when their authorized artifact is absent. A skip is reported as a skip, not a pass. Do not point integration tests at an existing production database.

The standalone `npm run test:demo` uses the real API with generated data and an ephemeral in-memory store. It verifies 240 fictional schools, Top 200 pagination, two distinct province ranking directions, five-batch reconciliation and actual member/administrator login. It does not establish the accuracy of any real hiring, eligibility or university admission data.

The demo TypeScript sources can also be checked with:

```sh
node platform/api/node_modules/typescript/bin/tsc -p demo/tsconfig.json
```
