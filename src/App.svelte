<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";
  import { PDFDocument } from "pdf-lib";
  import Annotation from "./components/Annotation.svelte";
  import type { AnnotationBox } from "./types/canvas";
  import type { PDFDocumentProxy } from "pdfjs-dist";

  // Types for better type safety
  interface Coordinates {
    x: number;
    y: number;
  }

  /** ref for file input field*/
  let fileInput: HTMLInputElement;
  /** ref for page input field*/
  let pageInput: HTMLInputElement;
  /** ref for pdf canvas container*/
  let pdfCanvasContainer: HTMLDivElement;
  /** ref for pdf canvas, rendered the actual PDF */
  let pdfCanvas: HTMLCanvasElement;
  /** ref for annotation canvas, rendered the annotations, not written to actual pdf so that edits don't need rerendering whole pdf */
  let annotationCanvas: HTMLCanvasElement;
  /** ref for drawing canvas, rendered the temporary box while drawing */
  let drawingCanvas: HTMLCanvasElement;
  /** ref for pdf context*/
  let pdfContext: CanvasRenderingContext2D | null = null;
  /** ref for annotation context*/
  let annotationContext: CanvasRenderingContext2D | null = null;
  /** ref for drawing context*/
  let drawingContext: CanvasRenderingContext2D | null = null;

  /** store for pdf document*/
  let pdfDocument = writable<PDFDocumentProxy | null>(null);
  /** store for current page*/
  let currentPage = writable<number>(1);
  /** store for number of pages*/
  let numPages = writable<number>(0);
  /** store for coordinates*/
  let coordinates = writable<Coordinates>({ x: 0, y: 0 });

  // New stores for box drawing
  let annotations = writable<AnnotationBox[]>([]);
  let isDrawing = false;
  let currentBox: AnnotationBox | null = null;
  let selectedAnnotationId = writable<number | null>(null);

  let scale = 1.5;

  // Keyboard event listener reference
  let keyboardListener: ((event: KeyboardEvent) => void) | null = null;

  onMount(() => {
    // Initialize PDF.js worker
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js";

    // Add keyboard event listener for box positioning
    keyboardListener = handleKeyboardBoxControl;
    window.addEventListener("keydown", keyboardListener);
  });

  onDestroy(() => {
    // Remove keyboard event listener
    if (keyboardListener) {
      window.removeEventListener("keydown", keyboardListener);
    }
  });

  // Handle file input change
  const onFileChange = async (event: Event): Promise<void> => {
    const target = event.target as HTMLInputElement;
    const file = target.files ? target.files[0] : null;
    if (file && file.type === "application/pdf") {
      const fileReader = new FileReader();
      fileReader.onload = () => {
        const typedArray = new Uint8Array(fileReader.result as ArrayBuffer);
        loadPdf(typedArray);
      };
      fileReader.readAsArrayBuffer(file);
    } else {
      alert("Please upload a valid PDF file.");
    }
  };

  // Load PDF
  const loadPdf = async (pdfData: Uint8Array): Promise<void> => {
    const loadedPdf = await window.pdfjsLib.getDocument({ data: pdfData })
      .promise;
    pdfDocument.set(loadedPdf);
    numPages.set(loadedPdf.numPages);
    renderPage(1);
  };

  // Render page with optimized canvas handling
  const renderPage = async (pageNumber: number): Promise<void> => {
    const pdf = $pdfDocument;
    if (!pdf) return;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    // get actual width of page
    const pdfWidth = viewport.width;
    const pdfHeight = viewport.height;

    // Create a new canvases for rendering
    const renderViewport = page.getViewport({ scale });
    pdfCanvas.width = renderViewport.width;
    pdfCanvas.height = renderViewport.height;
    annotationCanvas.width = renderViewport.width;
    annotationCanvas.height = renderViewport.height;
    drawingCanvas.width = renderViewport.width;
    drawingCanvas.height = renderViewport.height;

    pdfContext = pdfCanvas.getContext("2d");
    annotationContext = annotationCanvas.getContext("2d");
    drawingContext = drawingCanvas.getContext("2d");
    if (!pdfContext || !drawingContext || !annotationContext) {
      console.error("Could not get canvas context");
      // Reset ctx variables
      pdfContext = null;
      drawingContext = null;
      annotationContext = null;
      return;
    }
    pdfContext.clearRect(0, 0, renderViewport.width, renderViewport.height);
    annotationContext.clearRect(
      0,
      0,
      renderViewport.width,
      renderViewport.height
    );
    drawingContext.clearRect(0, 0, renderViewport.width, renderViewport.height);

    const renderContext = {
      canvasContext: pdfContext,
      viewport: renderViewport,
    };
    await page.render(renderContext).promise;

    // Render existing annotations
    renderAnnotations();

    // Mouse events for drawing boxes
    drawingCanvas.addEventListener("mousedown", startDrawingBox);
    drawingCanvas.addEventListener("mousemove", updateDrawingBox);
    drawingCanvas.addEventListener("mouseup", endDrawingBox);
    drawingCanvas.addEventListener("mouseout", endDrawingBox);

    // Coordinates tracking
    drawingCanvas.addEventListener("mousemove", (event: MouseEvent) => {
      const rect = drawingCanvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      const pdfX = (canvasX / drawingCanvas.width) * pdfWidth;
      const pdfY = pdfHeight - (canvasY / drawingCanvas.height) * pdfHeight;

      coordinates.set({
        x: parseFloat(pdfX.toFixed(2)),
        y: parseFloat(pdfY.toFixed(2)),
      });
    });

    drawingCanvas.addEventListener("mouseout", () => {
      coordinates.set({ x: 0, y: 0 });
    });
  };

  // Render all annotations
  const renderAnnotations = () => {
    if (!pdfContext || !drawingContext || !annotationContext) return;

    // Clear previous annotations
    annotationContext.clearRect(
      0,
      0,
      drawingCanvas.width,
      drawingCanvas.height
    );

    // Draw existing annotations
    $annotations.forEach((box) => {
      annotationContext!.strokeStyle = "rgba(0, 0, 255, 0.5)";
      annotationContext!.strokeRect(box.x, box.y, box.width, box.height);
    });
  };

  // Box drawing methods
  const startDrawingBox = (event: MouseEvent) => {
    if (!drawingContext || !pdfContext) return;

    const rect = pdfCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Clear temporary canvas
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    isDrawing = true;
    currentBox = {
      id: Date.now(),
      x,
      y,
      page: $currentPage,
      width: 0,
      height: 0,
      name: "",
    };
  };

  const updateDrawingBox = (event: MouseEvent) => {
    if (!isDrawing || !drawingContext || !pdfContext) return;

    const rect = pdfCanvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const box = currentBox;
    if (box) {
      // Clear temporary canvas and redraw existing annotations
      drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

      // Draw temporary box
      drawingContext.strokeStyle = "rgba(0, 0, 255, 0.5)";
      drawingContext.strokeRect(
        box.x,
        box.y,
        currentX - box.x,
        currentY - box.y
      );
      currentBox = {
        ...box,
        width: currentX - box.x,
        height: currentY - box.y,
      };
    }
  };

  const endDrawingBox = () => {
    if (
      !isDrawing ||
      !currentBox ||
      !pdfContext ||
      !drawingContext ||
      !annotationContext
    )
      return;

    const box = currentBox;
    if (box && box.width !== 0 && box.height !== 0) {
      annotations.update((boxes) => [...boxes, box]);
    }

    // Copy drawings to annotations layer
    annotationContext.drawImage(drawingCanvas, 0, 0);
    // Clear drawing canvas
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    isDrawing = false;
    currentBox = null;
  };

  // Keyboard control for box positioning
  const handleKeyboardBoxControl = (event: KeyboardEvent) => {
    if (!$selectedAnnotationId || !pdfContext || !drawingContext) return;

    const selectedBox = $annotations.find(
      (box) => box.id === $selectedAnnotationId
    );
    if (!selectedBox) return;

    const moveAmount = event.shiftKey ? 10 : 1;

    annotations.update((boxes) =>
      boxes.map((box) => {
        if (box.id === $selectedAnnotationId) {
          switch (event.key) {
            case "ArrowLeft":
              box.x -= moveAmount;
              break;
            case "ArrowRight":
              box.x += moveAmount;
              break;
            case "ArrowUp":
              box.y -= moveAmount;
              break;
            case "ArrowDown":
              box.y += moveAmount;
              break;
          }
        }
        return box;
      })
    );

    // Clear and redraw annotations
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    renderAnnotations();
  };

  // Remove annotation
  const removeAnnotation = (id: number) => {
    annotations.update((boxes) => boxes.filter((box) => box.id !== id));
    selectedAnnotationId.set(null);
    renderAnnotations();
  };

  // Handle page change
  const onPageChange = (): void => {
    const pageNumber = parseInt($currentPage.toString(), 10);
    if ($pdfDocument && pageNumber >= 1 && pageNumber <= $numPages) {
      renderPage(pageNumber);
    }
  };

  const addFieldsAndDownload = async () => {
    try {
      if (!$pdfDocument) return;
      // Get the original PDF data
      const pdfBytes = await $pdfDocument.getData();

      // Create a new PDF document
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // Group annotations by page
      const pageAnnotationMap: Record<number, AnnotationBox[]> = {};
      for (const box of $annotations) {
        if (!pageAnnotationMap[box.page]) pageAnnotationMap[box.page] = [box];
        else pageAnnotationMap[box.page].push(box);
      }

      // Add form fields for each annotation
      for (const [pageNum, boxes] of Object.entries(pageAnnotationMap)) {
        const page = pdfDoc.getPage(parseInt(pageNum) - 1);
        const { width: pdfWidth, height: pdfHeight } = page.getSize();

        for (const box of boxes) {
          const fieldName = box.name || `Field_${box.id}`;

          // Convert canvas coordinates to PDF coordinates
          const canvasX = box.x;
          const canvasY = box.y;

          // Use the same conversion logic as in mousemove handler
          const pdfX = (canvasX / drawingCanvas.width) * pdfWidth;
          const pdfY = pdfHeight - (canvasY / drawingCanvas.height) * pdfHeight;

          // Convert width and height to PDF scale
          const pdfBoxWidth = (box.width / drawingCanvas.width) * pdfWidth;
          const pdfBoxHeight = (box.height / drawingCanvas.height) * pdfHeight;

          // Create text field with converted coordinates
          const textField = pdfDoc.getForm().createTextField(fieldName);
          textField.addToPage(page, {
            x: pdfX,
            y: pdfY - pdfBoxHeight, // Adjust Y position for height since PDF coordinates start from bottom
            width: pdfBoxWidth,
            height: pdfBoxHeight,
            borderWidth: 0,
            backgroundColor: undefined,
          });
        }
      }

      // Save and download the PDF
      const modifiedPdfBytes = await pdfDoc.save();
      const blob = new Blob([modifiedPdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "annotated.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error creating PDF:", error);
      alert("Error creating PDF. Check console for details.");
    }
  };
</script>

<div class="app-container">
  <div class="side-panel">
    <h3>PDF Controls</h3>
    <div>
      <input
        type="file"
        bind:this={fileInput}
        accept="application/pdf"
        on:change={onFileChange}
      />
    </div>
    <div>
      <label for="pageInput">Page: </label>
      <input
        type="number"
        bind:this={pageInput}
        bind:value={$currentPage}
        min="1"
        max={$numPages}
        on:input={onPageChange}
        disabled={!$pdfDocument}
      />
    </div>

    <div>
      <button on:click={addFieldsAndDownload}>Download</button>
    </div>

    <h3>Annotations</h3>
    {#if $annotations.length > 0}
      <div>
        {#each $annotations as annotation (annotation.id)}
          <Annotation
            {annotation}
            isSelected={annotation.id === $selectedAnnotationId}
            onSelect={selectedAnnotationId.set}
            onEdit={(id, name) => {
              annotations.update((boxes) =>
                boxes.map((box) => (box.id === id ? { ...box, name } : box))
              );
            }}
            onRemove={removeAnnotation}
          />
        {/each}
      </div>
    {/if}
  </div>

  <div class="pdf-viewer">
    <div class="pdf-container" bind:this={pdfCanvasContainer}>
      <canvas class="pdf-canvas" bind:this={pdfCanvas}></canvas>
      <canvas class="annotation-canvas" bind:this={annotationCanvas}></canvas>
      <canvas class="drawing-canvas" bind:this={drawingCanvas}></canvas>
    </div>
  </div>
</div>

<div id="coordinates">
  PDF Coordinates: X: {$coordinates.x}, Y: {$coordinates.y}
</div>

<style>
  .app-container {
    display: flex;
    height: 100dvh;
  }
  .side-panel {
    width: 200px;
  }
  .pdf-viewer {
    flex: 1;
    padding: 20px;
    overflow: auto;
  }
  .pdf-container {
    position: relative;
  }
  .drawing-canvas,
  .annotation-canvas {
    position: absolute;
    inset: 0;
  }
  canvas {
    border: 1px solid black;
  }
  #controls {
    display: flex;
    justify-content: center;
    padding: 10px;
    background-color: #f0f0f0;
  }
  #controls input {
    margin: 0 10px;
  }
  #coordinates {
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 14px;
  }
</style>
