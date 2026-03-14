# Exporting Timelines and Images

PlannerTool includes an export tool to produce a portable representation of the current timeline for sharing or offline review.

## What you can export
- SVG: vector representation of the timeline and visible annotations. Best when you need high-quality scalable output.
- PNG: raster snapshot suitable for embedding in slides or documents.
- Copy to clipboard: copies an image representation for quick pasting into chat or email.

## Where to find the export tool
- Open the Top Menu → Tools → Export Timeline (if the Export plugin is enabled).

## Usage notes
- The export captures the visible timeline viewport and applied filters. Pan/zoom to the desired view before exporting.
- Annotations added via the annotations plugin are included in the export when enabled.
- Exports may include layered SVG elements; some styling may vary by browser when converting to PNG.

## Troubleshooting
- If exported text looks different from the on-screen font, check browser font availability and try exporting as SVG for fidelity.
- Large timelines may produce very large PNG files — consider exporting a cropped view or a smaller viewport.

## Limitations
Since there is no native bowser support to export browser DOMs the tool renders the board content independently as SVG.
This SVG is eith erexported directly, or rasterised to PNG format.
SVGs can render all tasks loaded in the tool. PNG rasterisation is limited by a PNG height threshold of 32768 lines. If you have a very large amount of featurecards to export to PNG this may fail for that reason.
Because of the internal rendering of the DOM as SVG there may be differences in how cards look on screen and ax exported files.
