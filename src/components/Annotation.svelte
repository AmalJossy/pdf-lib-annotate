<script lang="ts">
  import type { AnnotationBox } from "../types/canvas";

  export let annotation: AnnotationBox;
  export let isSelected = false;
  export let onSelect: (id: number) => void;
  export let onEdit: (id: number, name: string) => void;
  export let onRemove: (id:number) => void;

  let isEditing = false;
  let editedName = annotation.name;

  const confirmEdit = () => {
    onEdit(annotation.id, editedName);
    isEditing = false;
  };
</script>

<div
  class:selected={isSelected}
  role="button"
  tabindex="0"
  on:click={() => onSelect(annotation.id)}
  on:keydown={()=>{/* TODO */}}
  class="annotation-item"
>
  {#if isEditing}
    <input
      type="text"
      bind:value={editedName}
      on:keydown={(e) => e.key === "Enter" && confirmEdit()}
    />
    <button on:click={confirmEdit}>✔️</button>
  {:else}
    <span>{annotation.name || `Box ${annotation.id}`}</span>
    <button on:click={() => (isEditing = true)}>✏️</button>
    <button on:click={() => onRemove(annotation.id)}>D</button>
  {/if}
</div>

<style>
  .annotation-item {
    padding: 5px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .annotation-item.selected {
    border: 1px solid blue;
    background-color: rgba(0, 0, 255, 0.1);
  }
  input {
    margin-right: 5px;
  }
</style>
