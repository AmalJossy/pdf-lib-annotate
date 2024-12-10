<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { writable } from "svelte/store";

  // Types for better type safety
  interface Coordinates {
    x: number;
    y: number;
  }

  interface AnnotationBox {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
  }

  let fileInput: HTMLInputElement;
  let pageInput: HTMLInputElement;
  let pdfCanvasContainer: HTMLDivElement;
  let pdfCanvas: HTMLCanvasElement;
  let drawingCanvas: HTMLCanvasElement;
  let pdfContext: CanvasRenderingContext2D | null = null;
  let drawingContext: CanvasRenderingContext2D | null = null;

  let pdfDocument = writable<any>(null);
  let currentPage = writable<number>(1);
  let numPages = writable<number>(0);
  let coordinates = writable<Coordinates>({ x: 0, y: 0 });

  // New stores for box drawing
  let annotations = writable<AnnotationBox[]>([]);
  let isDrawing = writable<boolean>(false);
  let currentBox = writable<AnnotationBox | null>(null);
  let selectedAnnotationId = writable<number | null>(null);

  let pdfUrl = "";
  let scale = 1.5;
  let newBoxName = "";

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
    const loadedPdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    pdfDocument.set(loadedPdf);
    numPages.set(loadedPdf.numPages);
    renderPage(1);
  };

  // Render page with optimized canvas handling
  const renderPage = async (pageNumber: number): Promise<void> => {
    const pdf = $pdfDocument;
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    // get actual width of page
    const pdfWidth = viewport.width;
    const pdfHeight = viewport.height;

    // Create a new canvas for rendering
    const renderViewport = page.getViewport({ scale });
    pdfCanvas.width = renderViewport.width;
    pdfCanvas.height = renderViewport.height;
    drawingCanvas.width = renderViewport.width;
    drawingCanvas.height = renderViewport.height;

    const newContext = pdfCanvas.getContext("2d");
    const tempContext = drawingCanvas.getContext("2d");
    if (!newContext || !tempContext) {
      console.error("Could not get canvas context");
      return;
    }
    newContext.clearRect(0, 0, renderViewport.width, renderViewport.height);
    tempContext.clearRect(0, 0, renderViewport.width, renderViewport.height);

    const renderContext = {
      canvasContext: newContext,
      viewport: renderViewport,
    };
    await page.render(renderContext);

    pdfContext = newContext;
    drawingContext = tempContext;

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
    if (!pdfContext || !drawingCanvas || !drawingContext) return;

    // Clear previous annotations
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    // Draw existing annotations
    $annotations.forEach((box) => {
      drawingContext!.strokeStyle = "rgba(0, 0, 255, 0.5)";
      drawingContext!.strokeRect(box.x, box.y, box.width, box.height);
    });

    // Copy temporary canvas to main canvas
    pdfContext.drawImage(drawingCanvas, 0, 0);
  };

  // Box drawing methods
  const startDrawingBox = (event: MouseEvent) => {
    if (!drawingContext || !pdfContext) return;

    const rect = pdfCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Clear temporary canvas
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    isDrawing.set(true);
    currentBox.set({
      id: Date.now(),
      x,
      y,
      width: 0,
      height: 0,
      name: "",
    });
  };

  const updateDrawingBox = (event: MouseEvent) => {
    if (!$isDrawing || !drawingContext || !pdfContext) return;

    const rect = pdfCanvas.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;

    const box = $currentBox;
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
      currentBox.set({
        ...box,
        width: currentX - box.x,
        height: currentY - box.y,
      });
    }
  };

  const endDrawingBox = () => {
    if (!$isDrawing || !$currentBox || !pdfContext || !drawingContext) return;

    const box = $currentBox;
    if (box.width !== 0 && box.height !== 0) {
      annotations.update((boxes) => [
        ...boxes,
        {
          ...box,
        },
      ]);
    }

    // Copy temporary canvas to main canvas
    pdfContext.drawImage(drawingCanvas, 0, 0);
    // Clear temporary canvas
    drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    isDrawing.set(false);
    currentBox.set(null);
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

  // Add name to annotation
  const addNameToAnnotation = () => {
    if ($selectedAnnotationId && newBoxName) {
      annotations.update((boxes) =>
        boxes.map((box) =>
          box.id === $selectedAnnotationId ? { ...box, name: newBoxName } : box
        )
      );
      newBoxName = "";
    }
  };

  // Remove annotation
  const removeAnnotation = (id: number) => {
    annotations.update((boxes) => boxes.filter((box) => box.id !== id));
    selectedAnnotationId.set(null);

    // Clear and redraw annotations
    if (drawingContext && pdfContext) {
      drawingContext.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      renderAnnotations();
    }
  };

  // Handle page change
  const onPageChange = (): void => {
    const pageNumber = parseInt($currentPage.toString(), 10);
    if ($pdfDocument && pageNumber >= 1 && pageNumber <= $numPages) {
      renderPage(pageNumber);
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

    <h3>Annotations</h3>
    {#if $annotations.length > 0}
      <div>
        {#each $annotations as annotation (annotation.id)}
          <div
            class="annotation-list-item"
            class:selected-annotation={$selectedAnnotationId === annotation.id}
            on:click={() => selectedAnnotationId.set(annotation.id)}
          >
            <span>{annotation.name || `Box ${annotation.id}`}</span>
            <button on:click={() => removeAnnotation(annotation.id)}>🗑️</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if $selectedAnnotationId}
      <div>
        <input
          type="text"
          bind:value={newBoxName}
          placeholder="Enter box name"
        />
        <button on:click={addNameToAnnotation}>Add Name</button>
      </div>
    {/if}
  </div>

  <div class="pdf-viewer">
    <div class="pdf-container" bind:this={pdfCanvasContainer}>
      <canvas class="pdf-canvas" bind:this={pdfCanvas}></canvas>
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
  .drawing-canvas {
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
