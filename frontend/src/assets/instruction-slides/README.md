# Instruction slides

Images placed in this folder are shown as an auto-advancing slideshow on the
pre-exam **Important Instructions** page (right column, under the "Ready for a
fair assessment?" guidelines) — for both the SEB and normal-browser flows.

## How to add / change slides

1. Drop image files directly in this folder.
2. Name them with a numeric prefix so they play in the order you want:
   `01-lighting.png`, `02-background.png`, `03-framing.png`, `04-connection.png`, …
3. That's it — no code change. The `InstructionSlideshow` component picks them
   up automatically (via `import.meta.glob`) on the next build / dev reload.

## Format guidance

- Supported extensions: `.png` `.jpg` `.jpeg` `.webp`
- Aspect ratio: **2:1** (e.g. 1200×600). Other ratios are letter-boxed, not cropped.
- Keep any text baked into the image near the centre — the slideshow reserves a
  2:1 box and fits the whole image inside it (`object-contain`).
- If this folder has no images, the slideshow panel simply doesn't render.
