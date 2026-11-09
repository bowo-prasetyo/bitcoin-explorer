# Assay brand

## The mark

A gold ingot with a check mark struck into its top face.

To *assay* is to test a metal independently and stamp it with the result.
Assay does that for Bitcoin data, so the mark is the stamped bar: the
check is the verdict your browser reached itself. The trapezoid also
reads as a block, which ties it to Bitcoin without using the ₿ symbol.

## Files

| File | Use |
|---|---|
| `assay-mark.svg` | The mark alone, with the shaded ingot. 32 px and up. |
| `assay-logo.svg` | Mark and wordmark, light text, for dark backgrounds (the app). |
| `assay-logo-on-light.svg` | Mark and wordmark, dark text, for light backgrounds. |
| `../favicon.svg` | Simplified mark: one flat shape, taller, heavier check. For 16–32 px. |
| `../favicon.ico` | 16, 32 and 48 px raster of `favicon.svg`, for older browsers. |
| `../apple-touch-icon.png` | 180 px, the mark on an opaque ink tile (iOS fills transparency with black). |

The wordmark is converted to outlines, so the SVGs don't depend on any
installed font.

## Colours

| Name | Hex | Role |
|---|---|---|
| Assay gold | `#F0B232` | The ingot's face, the favicon |
| Deep gold | `#B97F14` | The ingot's sides |
| Ink | `#121212` | The check mark; dark backgrounds |
| Paper | `#F3EEE4` | Wordmark on dark backgrounds |

## Type

The wordmark is set in [Inter](https://rsms.me/inter/) SemiBold (SIL Open Font
License) at slightly tight tracking.

## Usage

- Keep clear space around the mark of at least a quarter of its height.
- Below 32 px, use the favicon version: the shaded face and thin sides of
  the full mark blur together at that size.
- Don't recolour, rotate, outline or add effects to the mark. Don't swap
  the check for another symbol.
- The gold is for the brand. In the interface, ✓ green and ✗ red still
  carry the meaning of a check's result.
