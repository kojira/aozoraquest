/** Shared bounded rasterizer for editor overviews. Never create a DOM node per world tile. */
export function paintTerrainOverview(ctx: CanvasRenderingContext2D, pixels: number, size: number, colorAt: (x: number, y: number) => string) {
  const image = ctx.createImageData(pixels, pixels);
  for (let y = 0; y < pixels; y++) for (let x = 0; x < pixels; x++) {
    const color = colorAt(Math.floor(x * size / pixels), Math.floor(y * size / pixels));
    const i = (y * pixels + x) * 4;
    image.data[i] = parseInt(color.slice(1, 3), 16);
    image.data[i + 1] = parseInt(color.slice(3, 5), 16);
    image.data[i + 2] = parseInt(color.slice(5, 7), 16);
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
