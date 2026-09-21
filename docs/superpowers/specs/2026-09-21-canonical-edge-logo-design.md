# Canonical Edge Logo Design

## Goal

Preserve the currently approved Edge 300×300 logo as the canonical store asset so `npm run assets` cannot replace it with a browser-rendered variant.

## Design

`store/assets/source/edge-logo-300.png` will contain the approved current PNG. The asset manifest will classify it as a copied source asset, alongside the existing Chrome icon, and the renderer will copy its declared source path into `store/assets/generated/edge-logo-300.png`.

The generated file remains part of the required store-artwork set and must retain its 300×300 dimension. Unit coverage will also require its bytes to equal the canonical source image, so future changes must deliberately replace the source asset rather than silently alter it through page rendering.

## Scope

Only the Edge store-logo source, asset manifest, renderer, regression tests, and store-material documentation change. Other promo images and screenshots continue to be rendered normally.
