function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

function getSvgSize(svg: string) {
  const documentElement = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const width = Number(documentElement.getAttribute("width")) || 1;
  const height = Number(documentElement.getAttribute("height")) || 1;
  return { width, height };
}

export function exportTimingSVG(svg: string) {
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "timing_diagram.svg");
}

export async function exportTimingPNG(svg: string) {
  const { width, height } = getSvgSize(svg);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const scale = 2;
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("PNG export failed: canvas is unavailable."));
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);

        const link = document.createElement("a");
        link.download = "timing_diagram.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
        resolve();
      };
      image.onerror = () => reject(new Error("PNG export failed: SVG could not be rendered."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
