# Shopify-like documentation navigation

## Goal

Make the focused reader's directory match Shopify.dev's navigation model instead
of exposing only the first URL segment found in the local database.

## Root navigation

The directory root always presents these curated sections in this order:

1. Apps, linked to `/docs/apps`.
2. Storefronts, linked to `/docs/storefronts`.
3. Agents, linked to `/docs/agents`.
4. References, backed by the existing `/docs/api` branch.

Apps, Storefronts, and Agents remain visible even before their landing page has
been cached. Visiting an uncached landing page uses the existing reader behavior:
enqueue a high-priority ingestion job, then enqueue translation jobs after the
page is fetched.

## References

References is a curated label for `/docs/api`, not a new source page. Expanding
it loads the existing dynamic `/docs/api` branch, which includes Admin API,
Storefront API, Liquid, Hydrogen, Functions, Polaris, Shopify CLI, and any future
reference families discovered from Shopify.dev.

Below the root, navigation remains path-driven and lazy-loaded. This avoids
loading thousands of API pages in one response and preserves the current tree
behavior for version, query, mutation, object, and scalar paths.

## Data flow

`GET /api/navigation?parent=/docs` combines the curated root definition with
active `source_pages` entries. Requests for deeper parents continue to query
active paths below that parent and build their immediate children.

The client keeps using `NavigationNode.path` both as the page link and as the
parent key for lazy expansion. References uses `/docs/api`, so no virtual route
or database migration is required.

## Failure behavior

If a deeper navigation request fails, the branch displays the existing directory
load error. Empty dynamic branches remain hidden. Curated root entries remain
available even when the corresponding landing page is absent from the local
database.

## Verification

Unit tests cover the curated root order and labels, visibility of Agents without
a cached source page, and unchanged dynamic behavior below `/docs/api`. Component
tests verify that the drawer renders the four root sections and expands
References through the `/docs/api` endpoint.
