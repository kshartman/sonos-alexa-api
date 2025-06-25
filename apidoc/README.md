# API Documentation Structure

This directory contains the OpenAPI 3.0 specification for the Sonos Alexa API, broken into manageable segments for easier maintenance.

## Structure

```
apidoc/
├── openapi.yaml           # Main entry point
├── components/            # Reusable components
│   ├── info.yaml         # API info and description
│   ├── servers.yaml      # Server definitions
│   ├── tags.yaml         # Tag definitions
│   ├── parameters.yaml   # Common parameters
│   ├── responses.yaml    # Common responses
│   ├── schemas.yaml      # Data schemas
│   └── security.yaml     # Security schemes
└── paths/                # Endpoint definitions
    ├── system/          # System endpoints
    ├── room/            # Room-specific endpoints
    ├── global/          # Global/default endpoints
    └── debug/           # Debug endpoints
```

## Usage

The main OpenAPI specification is in `openapi.yaml`, which references all other files using `$ref`.

To view the API documentation:

1. **Using Swagger UI**:
   ```bash
   docker run -p 8080:8080 -e SWAGGER_JSON=/openapi.yaml -v $(pwd):/usr/share/nginx/html swaggerapi/swagger-ui
   ```

2. **Using ReDoc**:
   ```bash
   docker run -p 8080:80 -v $(pwd):/usr/share/nginx/html/spec redocly/redoc
   ```

3. **Generate a single file** (if needed):
   ```bash
   npx @redocly/cli bundle openapi.yaml -o openapi-bundled.yaml
   ```

## Maintenance

When adding new endpoints:

1. Add the path reference to `openapi.yaml`
2. Create the endpoint file in the appropriate `paths/` subdirectory
3. Reference common components using `$ref` where possible
4. Update schemas in `components/schemas.yaml` if new data types are needed

## Validation

To validate the OpenAPI specification:

```bash
npx @redocly/cli lint openapi.yaml
```