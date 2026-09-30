<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { akskState } from '../akskState';
import { handleAkskOAuthCallback } from '../auth/pkce';

const router = useRouter();
const phase = ref<'processing' | 'retrying' | 'error'>('processing');
const errorMessage = ref('');

// qiankun mount window 内直接写 history 会被宿主 reroute 吞掉；通过整页回到门户壳，
// 让已落入 sessionStorage 的令牌由新的子应用实例稳定读取。
function navigateAfterCallback(target: string) {
  if (akskState.bridge) {
    window.location.replace(`.${target}`);
    return Promise.resolve();
  }
  return router.replace(target);
}

onMounted(async () => {
  // qiankun 的 Window Proxy 会使顶层子应用的 top/self 比较失真；只按真实 frameElement 判断。
  const silent = window.frameElement !== null;
  try {
    const outcome = await handleAkskOAuthCallback({ silent });
    if (outcome.kind === 'silent') {
      return;
    }
    if (outcome.kind === 'missing-params') {
      await navigateAfterCallback('/');
      return;
    }
    if (outcome.kind === 'retrying') {
      phase.value = 'retrying';
      return;
    }
    await navigateAfterCallback(outcome.target || '/clients');
  } catch (error) {
    phase.value = 'error';
    errorMessage.value = error instanceof Error ? error.message : '授权回调处理失败';
  }
});
</script>

<template>
  <section class="management-page">
    <p v-if="phase === 'processing'" class="admin-message" role="status">正在完成授权…</p>
    <p v-else-if="phase === 'retrying'" class="admin-message" role="status">授权码已失效，正在重新发起授权…</p>
    <p v-else class="admin-message error" role="alert">{{ errorMessage }}</p>
  </section>
</template>
