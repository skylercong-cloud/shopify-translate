# Build Shopify apps

Use the [Admin API](https://shopify.dev/docs/api/admin-graphql) with `npm run dev`, `shopify.app.toml`, and `Product`.

## Development steps

- Create the app
  1. Configure the project
  2. Run the development server

| Field | Description |
| --- | --- |
| `name` | App name |
| `handle` | App handle |

> Warning: Keep access tokens private.

```typescript
// Keep this comment in English
const productType = "Product";
```

![App architecture](https://cdn.shopify.com/example/app.png "Architecture diagram")
