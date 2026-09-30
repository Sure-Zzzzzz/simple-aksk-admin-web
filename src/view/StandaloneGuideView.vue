<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next';
</script>

<template>
  <section class="admin-empty-state">
    <KeyRound class="dashboard-icon" aria-hidden="true" />
    <h2>请从统一应用门户进入</h2>
    <p>本页面是 AKSK 管理的微前端子应用，需由统一应用门户加载后使用：门户负责登录态，本应用在门户内通过授权码链自动获取访问令牌。</p>
  </section>
</template>
