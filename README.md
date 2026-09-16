docker 5

# Field Data Application

Offline internal data-entry website built with React, TypeScript, Express, Prisma, PostgreSQL, Nginx, and Docker Compose. See the project blueprint in `Docker-Template.md` (governing documentation path is recorded in `AGENTS.md`).

> [!IMPORTANT]
> Install only feature-gated packages approved by `Docker-Lib.md` and the active task. Use reviewed exact versions, let npm update the relevant lockfile, and never introduce `PIN_VERSION`, `latest`, or a floating range.

## Repository layout

```text
docker-field-app/
|-- AGENTS.md
|-- README.md
|-- compose.yaml
|-- compose.dev.yaml
|-- .env.example
|-- .env.seed.example
|-- .env.test.example
|-- .gitignore
|-- frontend/
|-- backend/
|-- scripts/
```

## First-time setup

### 1. Review the pinned manifests

Confirm that both package manifests contain only exact versions approved for implemented features and that neither manifest contains `PIN_VERSION` or a floating range.

### 2. Create local environment files

```powershell
Copy-Item .env.example .env
Copy-Item .env.test.example .env.test
```

Change every placeholder secret in `.env` and `.env.test` before starting the application or tests. Create `.env.seed` only for the controlled initial Admin operation below, then remove it.

### 3. Install locked dependencies

```powershell
Push-Location frontend
npm ci
Pop-Location

Push-Location backend
npm ci
Pop-Location
```

Use `npm install --save-exact <approved-package>@<version>` only when an active task authorizes a dependency change so npm updates the lockfile.

### 4. Lint, type-check, and test

```powershell
Push-Location frontend
npm run lint
npm run typecheck
npm test
npm run build
Pop-Location

Push-Location backend
npm run lint
npm run typecheck
npm test
npm run build
Pop-Location
```

## Local development

```powershell
docker compose -f compose.dev.yaml up --build
```

Frontend: http://127.0.0.1:5173
Backend: http://127.0.0.1:3000/api/health

## Authentication API

The backend exposes:

```text
POST /api/auth/login   { "username": "...", "password": "..." }
POST /api/auth/logout
GET  /api/auth/me
```

Login returns `{ "data": { "user": ... } }` and sets the configured HttpOnly, `SameSite=Strict` session cookie. The session is stored in PostgreSQL and contains only the user ID. Invalid credentials use one generic `401` response; invalid request fields use `422`. Logout destroys the server session and returns `204`, including when repeated.

No development Admin or field data is created automatically. Authentication and assigned-field flows are covered against the dedicated test database; use the controlled initial application seed below when an installation is ready to create its real account and first field.

## Frontend routes

The frontend restores the current server session before opening protected pages:

```text
/login                 Username/password login
/                      Assigned-field dashboard
/fields/:fieldSlug     Assignment-protected field page
```

The dashboard renders only the active field descriptors returned by the backend. Direct navigation to a field route still performs protected descriptor and form-definition requests; hiding a card is not an authorization boundary. Phase 2 renders the current published form as a validated, non-submittable preview. It shows the authenticated user as Submitted by and deliberately has no confirmation, Submit, or history controls yet.

## Authorization middleware

Protected backend routes must compose middleware in this order:

```text
authenticate -> requireRole(...) when role-specific -> requireFieldAccess(...) when field-specific -> handler
```

`requireRole` uses an explicit role allowlist; roles do not inherit one another automatically. `requireFieldAccess()` requires every Worker, Manager, or Admin to have a current assignment to the active `:fieldSlug`. Use `requireFieldAccess({ requireCanSubmit: true })` for a future field-submission route so the current assignment must also have `canSubmit: true`. The middleware reloads role and assignment state from PostgreSQL and exposes only a trusted minimal `request.fieldAccess` context.

## Assigned field and form API

The application exposes these read-only production routes:

```text
GET /api/fields
GET /api/fields/:fieldSlug
GET /api/fields/:fieldSlug/form
```

`GET /api/fields` requires authentication and returns only active fields currently assigned to the session user, ordered for dashboard navigation. `GET /api/fields/:fieldSlug` and `GET /api/fields/:fieldSlug/form` use `requireFieldAccess()` and return `403 FIELD_ACCESS_FORBIDDEN` for an active but unassigned field or non-disclosing `404 FIELD_NOT_FOUND` for a missing/inactive field. Worker, Manager, and Admin follow the same explicit-assignment rule.

A successful descriptor contains only `name`, `slug`, `description`, the server-derived browser `route`, and current `canSubmit`. View access remains valid when `canSubmit` is `false`, including for the form-definition route.

The form response contains the opaque `formVersionId`, version number, active fields and options in stable display order, effective public constraints, and version-aware cross-field rules. It omits creator, module, field, and option database IDs. An assigned field without a published form returns `404 FORM_NOT_AVAILABLE`; multiple published versions fail safely instead of choosing one. Phase 2 publishes no submission, Manager, or Admin endpoint.

## Production

### Validate Compose configuration

```powershell
docker compose config
docker compose --profile tools config
docker compose -f compose.dev.yaml --profile tools config
```

### Build production images

```powershell
docker compose build backend frontend
docker compose --profile tools build tools
```

### Start the application

```powershell
docker compose up -d database
docker compose --profile tools run --rm tools npm run prisma:migrate
docker compose up -d
```

A normal deployment has exactly three running services: `database`, `backend`, `frontend`. The profile-gated `tools` container is one-shot and removed by `--rm`.

### Check service state

```powershell
docker compose ps
docker compose logs --tail 200 backend
```

Open the application at http://localhost:8080.

### Stop services without deleting data

```powershell
docker compose down
```

> [!WARNING]
> Do not use `docker compose down --volumes` on a system containing real data. It removes the PostgreSQL volume.

## Database initialization

### Create the first migration during development

```powershell
docker compose -f compose.dev.yaml up -d database
docker compose -f compose.dev.yaml --profile tools build tools
docker compose -f compose.dev.yaml --profile tools run --rm tools npm run prisma:dev -- --name initial_schema
```

### Apply committed migrations in production

```powershell
docker compose up -d database
docker compose --profile tools run --rm tools npm run prisma:migrate
```

### Provision the dedicated test database

After `.env.test` has been reviewed, provision the test database (separate from the development database, in the same development PostgreSQL cluster):

```powershell
docker compose --env-file .env --env-file .env.test -f compose.dev.yaml up -d database

$ensureTestDatabase = @'
set -eu
case "$TEST_POSTGRES_DB" in
  *[!A-Za-z0-9_]*) echo "Unsafe TEST_POSTGRES_DB" >&2; exit 2 ;;
esac
exists="$(psql --username "$POSTGRES_USER" --dbname postgres --tuples-only --no-align --command "SELECT 1 FROM pg_database WHERE datname = '$TEST_POSTGRES_DB'")"
if [ "$exists" != "1" ]; then
  createdb --username "$POSTGRES_USER" "$TEST_POSTGRES_DB"
fi
'@

docker compose --env-file .env --env-file .env.test -f compose.dev.yaml exec -T database sh -c $ensureTestDatabase
if ($LASTEXITCODE -ne 0) { throw "Test database provisioning failed." }

$verifyToolsTestTarget = @'
const target = new URL(process.env.DATABASE_URL);
const databaseName = target.pathname.replace(/^\//, "");
const expectedName = process.env.TEST_POSTGRES_DB;
if (target.hostname !== "database" || databaseName !== expectedName || !/(^|[_-])test([_-]|$)/i.test(databaseName)) {
  console.error("Refusing to migrate an unverified test database target.");
  process.exit(2);
}
'@

docker compose --env-file .env --env-file .env.test -f compose.dev.yaml --profile tools run --rm tools node -e $verifyToolsTestTarget
if ($LASTEXITCODE -ne 0) { throw "Tools test-database target verification failed." }

docker compose --env-file .env --env-file .env.test -f compose.dev.yaml --profile tools run --rm tools npm run prisma:migrate
if ($LASTEXITCODE -ne 0) { throw "Test database migration failed." }
```

### Controlled initial application seed

Password storage and the idempotent application seed are implemented. Run it only as a controlled installation step. Review every value locally and never place the password in command output or source control:

```powershell
Copy-Item .env.seed.example .env.seed
# Replace every placeholder in .env.seed, then run:
docker compose --env-file .env --env-file .env.seed --profile tools run --rm tools npm run prisma:seed
if ($LASTEXITCODE -ne 0) { throw "Initial application seed failed; keep .env.seed only long enough to diagnose safely." }
Remove-Item -LiteralPath .env.seed
```

The seed validates all four `ADMIN_*` values, hashes the password with Argon2, upserts the initial Admin and canonical Most Data field, creates the Admin's missing explicit assignment with `canSubmit: false`, and atomically creates the initial published Most Data form version when no form history exists. Version 1 contains the eleven configured response fields, the documented Heat and Status catalogs, provisional Building A/Morning/kg options, the Quantity all-or-none rule, and a 2,000-character Notes limit.

Reruns converge without duplicates, preserve later `canSubmit` changes, and never rewrite a published definition. If version 1 was changed or another form version exists, the seed rolls back and reports a safe failure so historical configuration is not silently repaired. Version-aware rules and effective limits are historical application constants: never mutate version-1 constants after use; create a new form version instead. This task verifies the complete seed only in `field_app_test`; it does not create `.env.seed` or seed the development database.

## Backup

```powershell
.\scripts\backup.ps1
```

The command reads `POSTGRES_USER` and `POSTGRES_DB` inside the database container, so the host shell does not need to import `.env` and no password is printed. Test every backup by restoring it to a separate test database.

## Restore

```powershell
.\scripts\restore.ps1 -InputFile .\backups\field-app-<timestamp>.sql -TargetDatabase field_app_test
```

The restore script refuses a target database whose name is not clearly marked as test data.

## Offline image export

After production images are built and tested:

```powershell
.\scripts\export-images.ps1
```

The offline installation package needs the built frontend, slim backend runtime, profile-gated migration tools, and PostgreSQL images. Pin full tested base-image tags before creating the archive.

### Recommended USB structure

```text
USB/
|-- field-app-images-1.0.0.tar
|-- app/
|   |-- compose.yaml
|   |-- .env
|   |-- .env.seed.example
|-- database/
|   |-- initial-backup.sql
|-- installer/
|   |-- Docker installer
|-- README.md
```

### Offline installation

```powershell
docker load -i field-app-images-1.0.0.tar
if ($LASTEXITCODE -ne 0) { throw "Offline image load failed." }

docker compose up -d database
if ($LASTEXITCODE -ne 0) { throw "Database startup failed." }

docker compose --profile tools run --rm tools npm run prisma:migrate
if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }

# After login/password storage exists, create and review .env.seed, then run once:
docker compose --env-file .env --env-file .env.seed --profile tools run --rm tools npm run prisma:seed
if ($LASTEXITCODE -ne 0) { throw "Initial Admin seed failed; .env.seed was retained for safe diagnosis." }
Remove-Item -LiteralPath .env.seed -ErrorAction Stop

docker compose up -d
if ($LASTEXITCODE -ne 0) { throw "Application startup failed." }
```
