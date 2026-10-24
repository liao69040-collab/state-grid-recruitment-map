# Deployment configuration template

The default demo is deliberately local and ephemeral. The API also contains PostgreSQL adapters and migrations for operators who bring their own licensed data and infrastructure.

1. Copy `.env.example` to a private location excluded from Git.
2. Set independent cryptographic values, your database URL and your own frontend/admin domains. `PHONE_ENCRYPTION_KEY` must encode exactly 32 random bytes in Base64.
3. Run the API's migrations against a new database, inspect the changes, and create an administrator using `npm run admin:create` in `platform/api`, supplying `SUPERADMIN_USERNAME` and `SUPERADMIN_PASSWORD` through your private environment. Reusing an existing username rotates that account's password and revokes its sessions.
4. Import only data you have permission to host; the public repository does not provide production imports.
5. Build all three applications and place them behind your HTTPS reverse proxy. Keep database access private and enforce authentication on the API.

Do not adapt the public demo account, keys, loopback server or in-memory store for a production service. This directory contains an environment template, not credentials or a deployment to any existing host.
