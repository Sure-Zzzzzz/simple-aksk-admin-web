<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  primaryLabel?: string;
}>();

const emit = defineEmits<{
  primary: [];
}>();
</script>

<template>
  <header class="admin-page-header">
    <div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="admin-page-actions">
      <slot name="actions">
        <button
          v-if="primaryLabel"
          class="button-primary"
          type="button"
          @click="emit('primary')"
        >
          {{ primaryLabel }}
        </button>
      </slot>
    </div>
  </header>
</template>
