/**
 * The scanner's image arithmetic: rotate, crop, and the contrast/threshold step
 * that OCR actually wants - pure functions over the pixels a canvas hands over.
 *
 * **Why these are pure and why they live in the renderer.** Every one of them
 * takes a bitmap and answers a NEW bitmap, so the page can preview exactly what
 * it is about to recognise (undo a turn, move a crop, turn the threshold off)
 * without a second copy of the arithmetic and without touching the pixels it
 * still needs. They take the shape `ImageData` satisfies structurally rather
 * than `ImageData` itself, which is what lets the tests build a three-pixel
 * fixture in a plain object and assert exact bytes - there is no canvas, and
 * deliberately no DOM library, in this repository's test environment.
 *
 * **Why the pixels are the only inputs a test needs.** A wrong rotation, an
 * off-by-one crop and a threshold that eats a light scan are all invisible in a
 * screenshot of the page: it draws a picture, and a picture of slightly wrong
 * pixels looks like a picture. So each function's contract is stated in bytes,
 * and `imageOps.test.ts` pins them on fixtures whose expected values were
 * worked out by hand (the arithmetic is written into the test beside them).
 */

/** A bitmap in the shape `ImageData` puts one in: `width * height * 4` bytes, RGBA, row-major. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** A crop rectangle in PIXELS, as the page computes one from its percentage fields or a drag. */
export interface ImageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A crop selection in PERCENTAGES of the image, which is the unit a person types and a drag reports. */
export interface SelectionPercent {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Rec. 601 luma, rounded to a whole byte. `0.299 + 0.587 + 0.114 = 1`, so white stays white and black stays black. */
function luma(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** A bitmap of the same size and the same bytes, so the caller's own copy is never written to. */
export function cloneImage(image: RgbaImage): RgbaImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/**
 * One quarter turn clockwise.
 *
 * The mapping is `dst(x, y) = src(y, h - 1 - x)` into a `height x width` result,
 * which is the standard clockwise quarter turn: with
 *
 * ```text
 * A B        C A
 * C D   ->   D B
 * ```
 *
 * the top-left pixel A lands at the top-right, exactly as turning the paper to
 * the right does.
 */
function rotateOnce(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const outWidth = height;
  for (let x = 0; x < outWidth; x += 1) {
    for (let y = 0; y < width; y += 1) {
      const from = ((height - 1 - x) * width + y) * 4;
      const to = (y * outWidth + x) * 4;
      out[to] = data[from] ?? 0;
      out[to + 1] = data[from + 1] ?? 0;
      out[to + 2] = data[from + 2] ?? 0;
      out[to + 3] = data[from + 3] ?? 0;
    }
  }
  return { width: outWidth, height: width, data: out };
}

/**
 * `turns` quarter turns clockwise. Negative and over-turning counts are reduced
 * rather than refused, because the page's two buttons are the same function with
 * `+1` and `-1` and neither should have to know how many turns came before it.
 */
export function rotateQuarterTurns(image: RgbaImage, turns: number): RgbaImage {
  let result = cloneImage(image);
  for (let index = 0; index < ((turns % 4) + 4) % 4; index += 1) result = rotateOnce(result);
  return result;
}

/**
 * The crop rectangle in pixels, clamped to the image and never degenerate.
 *
 * Percentages arrive from a drag or from four typed fields, and either can name
 * a rectangle hanging off the edge (the drag is clamped by the container, the
 * fields by nothing). Clamping here means `cropTo` is only ever handed a
 * rectangle that exists, so a crop can never be the way a page throws.
 */
export function selectionRect(image: RgbaImage, percent: SelectionPercent): ImageRect {
  const x = clamp(Math.round((percent.left / 100) * image.width), 0, image.width - 1);
  const y = clamp(Math.round((percent.top / 100) * image.height), 0, image.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round((percent.width / 100) * image.width), 1, image.width - x),
    height: clamp(Math.round((percent.height / 100) * image.height), 1, image.height - y),
  };
}

/** The pixels inside `rect`, as a new bitmap of exactly that size. */
export function cropTo(image: RgbaImage, rect: ImageRect): RgbaImage {
  const x = clamp(Math.floor(rect.x), 0, image.width - 1);
  const y = clamp(Math.floor(rect.y), 0, image.height - 1);
  const width = clamp(Math.floor(rect.width), 1, image.width - x);
  const height = clamp(Math.floor(rect.height), 1, image.height - y);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    out.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data: out };
}

/**
 * A selection made ON an already-cropped view, expressed in the FULL picture's
 * percentages.
 *
 * The crop is kept in percentages of the rotated picture, and the preview shows
 * it cropped - so a second drag happens inside the first selection. Taken
 * literally that would compound (10% of a 50% crop is 5% of the picture), and the
 * user would watch each drag shrink the frame by more than the rectangle they
 * drew. This maps the inner rectangle back through the outer one:
 * `left = L + l * W / 100`, and so on, which is the only reading of "I drew this
 * box on that view" that leaves the picture where the user put it.
 */
export function composeSelection(
  outer: SelectionPercent,
  inner: SelectionPercent,
): SelectionPercent {
  return {
    left: outer.left + (inner.left * outer.width) / 100,
    top: outer.top + (inner.top * outer.height) / 100,
    width: (inner.width * outer.width) / 100,
    height: (inner.height * outer.height) / 100,
  };
}

/** The image in greys: every channel carries the pixel's luma, alpha is left alone. */
export function grayscale(image: RgbaImage): RgbaImage {
  const out = new Uint8ClampedArray(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = luma(image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0);
    out[index] = value;
    out[index + 1] = value;
    out[index + 2] = value;
    out[index + 3] = image.data[index + 3] ?? 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * A levels stretch: the tones at `lowPercentile` and `highPercentile` become
 * black and white, and everything between is scaled linearly.
 *
 * Why a percentile stretch rather than a straight min/max: a single specular
 * pixel (a shop window's reflection on a receipt) is enough to make min/max
 * useless, while the 2nd and 98th percentile ignore a few outliers at each end
 * and still stretch a flat-looking scan. The curve is ONE linear map applied to
 * every channel, so a colour photo keeps its colours and a grey one stays grey.
 *
 * An image whose two percentiles are the same tone (a blank page) is answered
 * unchanged: there is no curve to draw, and inventing one would turn a white
 * sheet into noise.
 */
export function stretchContrast(
  image: RgbaImage,
  lowPercentile = 2,
  highPercentile = 98,
): RgbaImage {
  const tones = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < tones.length; pixel += 1) {
    const at = pixel * 4;
    tones[pixel] = luma(image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0);
  }
  const sorted = Array.from(tones).sort((a, b) => a - b);
  const low = sorted[Math.floor(((sorted.length - 1) * lowPercentile) / 100)] ?? 0;
  const high = sorted[Math.floor(((sorted.length - 1) * highPercentile) / 100)] ?? 255;
  if (high <= low) return cloneImage(image);

  const out = new Uint8ClampedArray(image.data.length);
  const scale = 255 / (high - low);
  for (let index = 0; index < image.data.length; index += 4) {
    out[index] = clamp(Math.round(((image.data[index] ?? 0) - low) * scale), 0, 255);
    out[index + 1] = clamp(Math.round(((image.data[index + 1] ?? 0) - low) * scale), 0, 255);
    out[index + 2] = clamp(Math.round(((image.data[index + 2] ?? 0) - low) * scale), 0, 255);
    out[index + 3] = image.data[index + 3] ?? 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * The level `binarise` uses when the caller names none: the image's mean luma,
 * rounded - the classic global mean threshold, and the honest simple answer for
 * a page of dark text on light paper (the mean sits in the paper's tone range,
 * so ink falls below it and paper above).
 */
export function meanLevel(image: RgbaImage): number {
  if (image.data.length === 0) return 0;
  let total = 0;
  let pixels = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    total += luma(image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0);
    pixels += 1;
  }
  return Math.round(total / pixels);
}

/** Black where a pixel's luma is below `level`, white where it is at or above it. Both channels and alpha are fully opaque. */
export function binarise(image: RgbaImage, level = meanLevel(image)): RgbaImage {
  const out = new Uint8ClampedArray(image.data.length);
  for (let index = 0; index < image.data.length; index += 4) {
    const value =
      luma(image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0) >= level
        ? 255
        : 0;
    out[index] = value;
    out[index + 1] = value;
    out[index + 2] = value;
    out[index + 3] = image.data[index + 3] ?? 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * The whole pre-recognition step, in the order that matters: greys the image,
 * widens its tone range, then binarises it at the mean level of the widened
 * result.
 *
 * Gray first because a binarisation is a decision about tone, and a decision
 * about tone that reads three channels separately is three decisions. Stretch
 * before the threshold because the threshold is a single number: on a
 * low-contrast scan the mean sits a long way from both ink and paper, and
 * widening the range first is what puts it between them.
 */
export function prepareForOcr(image: RgbaImage): RgbaImage {
  return binarise(stretchContrast(grayscale(image)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
