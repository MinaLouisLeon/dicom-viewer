/**
 * Renders what a viewport element shows (image canvas, measurement layer and corner
 * text) into a PNG. Everything happens in the browser.
 */
export async function captureViewport(element: HTMLElement, overlay?: HTMLElement | null): Promise<Blob | undefined> {
  const source = element.querySelector('canvas');
  if (!source || source.width === 0 || source.height === 0) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0);

  const bounds = source.getBoundingClientRect();
  const scaleX = bounds.width ? canvas.width / bounds.width : 1;
  const scaleY = bounds.height ? canvas.height / bounds.height : 1;

  // Measurements and reference lines are drawn in an SVG layer above the canvas.
  const svg = element.querySelector('svg');
  if (svg) {
    try {
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(bounds.width));
      clone.setAttribute('height', String(bounds.height));
      const markup = new XMLSerializer().serializeToString(clone);
      const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } catch {
      // Keep the image without its annotations.
    }
  }

  if (overlay) {
    const fontSize = Math.round(12 * scaleY);
    context.font = `${fontSize}px system-ui, sans-serif`;
    context.fillStyle = '#e8eaed';
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 3 * scaleY;
    for (const span of overlay.querySelectorAll<HTMLElement>('span')) {
      if (span.children.length > 0 || !span.textContent) continue;
      const rect = span.getBoundingClientRect();
      if (rect.width === 0) continue;
      const x = (rect.left - bounds.left) * scaleX;
      const y = (rect.top - bounds.top) * scaleY + fontSize;
      context.fillText(span.textContent, x, y);
    }
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image failed to load'));
    image.src = src;
  });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
