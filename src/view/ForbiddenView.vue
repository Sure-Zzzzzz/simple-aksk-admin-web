<script setup lang="ts">
import { ShieldAlert } from 'lucide-vue-next';
import AkskPageHeader from '../components/AkskPageHeader.vue';
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      title="没有访问权限"
      description="当前账号缺少执行该操作所需的 AKSK 管理权限，请联系管理员在授权侧分配。"
    />
    <div class="admin-empty-state permission-empty">
      <ShieldAlert class="dashboard-icon" aria-hidden="true" />
      <h2>权限不足</h2>
      <p>各操作的权限在服务端校验：如整页拒绝，通常是缺少对应读取权限；单条操作报错则缺少该操作权限。</p>
    </div>
  </section>
</template>
