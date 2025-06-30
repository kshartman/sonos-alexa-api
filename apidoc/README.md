# API Documentation

This directory contains the OpenAPI 3.0 specification for the Sonos Alexa API.

## Structure

```
apidoc/
├── openapi.yaml           # Complete OpenAPI specification
└── README.md             # This file
```

## Usage

To view the API documentation:

1. **Using Swagger UI**:
   ```bash
   docker run -p 8080:8080 -e SWAGGER_JSON=/api/openapi.yaml -v $(pwd):/api swaggerapi/swagger-ui
   ```
   Then open http://localhost:8080

2. **Using ReDoc**:
   ```bash
   npx @redocly/cli preview-docs openapi.yaml
   ```
   Then open http://localhost:8080

3. **Using VS Code**: Install the "OpenAPI (Swagger) Editor" extension

## Validation

To validate the OpenAPI specification:

```bash
npx @redocly/cli lint openapi.yaml
```

## Current Status

The OpenAPI specification is functional but incomplete. Many endpoints are documented but some are missing:
- Detailed request/response schemas
- Example values
- Some newer endpoints

## Future Improvements

- Add missing endpoint documentation
- Add request/response examples
- Consider modularizing into components for easier maintenance
- Add automated API testing based on the spec