<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { akskState } from './akskState';
import { cancelAkskTokenRenewal, scheduleAkskTokenRenewal } from './auth/pkce';

const standalone = computed(() => !akskState.bridge);

// 令牌获取/续签/失效恢复统一由 API 内核 401 驱动（iframe 静默授权优先，失败才整页授权链），
// 此处只负责续签调度与生命周期清理。
onMounted(() => {
  scheduleAkskTokenRenewal();
});

onUnmounted(() => {
  cancelAkskTokenRenewal();
});
</script>

<template>
  <section class="aksk-admin-app">
    <header v-if="standalone" class="aksk-admin-header">
      <div>
        <span>AKSK 访问凭证管理</span>
        <h1>AKSK 管理</h1>
      </div>
    </header>
    <RouterView />
  </section>
</template>
