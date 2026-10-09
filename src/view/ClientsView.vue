<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AkskPageHeader from '../components/AkskPageHeader.vue';
import CopyButton from '../components/CopyButton.vue';
import Pagination from '@sure-zzzzzz/simple-iam-theme-contract/Pagination';
import DataTable, { type DataTableColumn } from '@sure-zzzzzz/simple-iam-theme-contract/DataTable';
import {
  listAkskClients,
  updateAkskClient,
  type AkskClientInfo
} from '../api/akskAuth';

const router = useRouter();

const clientColumns: DataTableColumn[] = [
  { key: 'clientId', label: '客户端' },
  { key: 'clientType', label: '类型' },
  { key: 'ownerLabel', label: '归属' },
  { key: 'enabled', label: '状态' },
  { key: 'clientIdIssuedAt', label: '签发时间' },
  { key: 'actions', label: '操作', align: 'right' },
];

const clients = ref<AkskClientInfo[]>([]);
const loading = ref(false);
const message = ref('');
const errorMessage = ref('');
const togglePendingClientId = ref('');

const filterForm = reactive({
  type: '' as '' | 'platform' | 'user',
  ownerUserId: ''
});

const pageSize = ref(20);
const currentPage = ref(1);
const totalPages = ref(1);
const totalElements = ref(0);

const typeTabs = [
  { value: '' as const, label: '全部' },
  { value: 'platform' as const, label: '平台级 AKP' },
  { value: 'user' as const, label: '用户级 AKU' }
];

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function ownerLabel(client: AkskClientInfo): string {
  return client.ownerUsername || client.ownerUserId || '—';
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value || page === currentPage.value) {
    return;
  }
  currentPage.value = page;
  void loadClients();
}

function changePageSize(size: number) {
  if (size < 1 || size === pageSize.value) {
    return;
  }
  pageSize.value = size;
  currentPage.value = 1;
  void loadClients();
}

function searchClients() {
  currentPage.value = 1;
  void loadClients();
}

function resetFilters() {
  Object.assign(filterForm, { type: '', ownerUserId: '' });
  searchClients();
}

async function loadClients() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const page = await listAkskClients({
      ...(filterForm.type ? { type: filterForm.type } : {}),
      ...(filterForm.ownerUserId.trim() ? { ownerUserId: filterForm.ownerUserId.trim() } : {}),
      page: currentPage.value,
      size: pageSize.value
    });
    clients.value = page.data;
    totalElements.value = page.total;
    totalPages.value = Math.max(page.totalPages, 1);
    currentPage.value = page.page;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '加载客户端列表失败';
  } finally {
    loading.value = false;
  }
}

async function toggleClient(client: AkskClientInfo) {
  message.value = '';
  errorMessage.value = '';
  togglePendingClientId.value = client.clientId;
  try {
    await updateAkskClient(client.clientId, { enabled: !client.enabled });
    message.value = client.enabled ? `已禁用 ${client.clientId}` : `已启用 ${client.clientId}`;
    await loadClients();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '更新状态失败';
  } finally {
    togglePendingClientId.value = '';
  }
}

onMounted(() => {
  void loadClients();
});
</script>

<template>
  <section class="management-page">
    <AkskPageHeader
      title="客户端"
      description="管理 AKSK 客户端：平台级 AKP 与用户级 AKU 的创建、启停与归属维护；业务三权由 IAM 授权投影决定。"
      primary-label="新建客户端"
      @primary="router.push('/clients/create')"
    />
    <p v-if="message" class="admin-message success" role="status">{{ message }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="message = ''">×</button></p>
    <p v-if="errorMessage" class="admin-message error" role="alert">{{ errorMessage }}<button class="admin-message-dismiss" type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button></p>

    <section class="admin-data-surface">
      <div class="data-toolbar">
        <div>
          <h2>客户端列表 <span>{{ totalElements }}</span></h2>
          <p>平台级客户端归属业务系统，用户级客户端归属单个 IAM 用户。</p>
        </div>
      </div>
      <div class="data-toolbar filter-bar">
        <div class="search-field">
          <label class="sr-only" for="client-owner-filter">归属主体 ID</label>
          <input
            id="client-owner-filter"
            v-model="filterForm.ownerUserId"
            type="search"
            placeholder="按归属主体 ID 筛选"
            @keyup.enter="searchClients"
          >
        </div>
        <div class="admin-page-actions">
          <button class="button-primary" type="button" :disabled="loading" @click="searchClients">查询</button>
          <button class="button-secondary" type="button" :disabled="loading" @click="resetFilters">重置</button>
        </div>
      </div>
      <div class="type-filter-tabs" role="tablist" aria-label="客户端类型筛选">
        <button
          v-for="tab in typeTabs"
          :key="tab.value"
          type="button"
          :class="{ active: filterForm.type === tab.value }"
          @click="filterForm.type = tab.value; searchClients()"
        >
          {{ tab.label }}
        </button>
      </div>
      <DataTable
        :columns="clientColumns"
        :rows="clients"
        row-key="clientId"
        :loading="loading"
        empty-text="暂无符合条件的客户端。"
      >
        <template #cell-clientId="{ row }">
          <div class="client-cell">
            <button class="table-primary-action" type="button" @click="router.push(`/clients/${encodeURIComponent(row.clientId)}`)">
              <strong>{{ row.clientName }}</strong>
              <span>{{ row.clientId }}</span>
            </button>
            <CopyButton :value="row.clientId" label="AK" ghost />
          </div>
        </template>
        <template #cell-clientType="{ row }">
          <span class="status-badge" :class="row.clientType === 1 ? '' : 'warning'">
            {{ row.clientType === 1 ? 'AKP 平台级' : 'AKU 用户级' }}
          </span>
        </template>
        <template #cell-ownerLabel="{ row }">{{ ownerLabel(row) }}</template>
        <template #cell-enabled="{ row }">
          <span class="status-badge" :class="row.enabled ? 'success' : 'neutral'">
            {{ row.enabled ? '启用' : '禁用' }}
          </span>
        </template>
        <template #cell-clientIdIssuedAt="{ row }">{{ formatDateTime(row.clientIdIssuedAt) }}</template>
        <template #cell-actions="{ row }">
          <div class="table-actions-inline">
            <button class="table-action" type="button" @click="router.push(`/authorizations/${encodeURIComponent(row.clientId)}`)">配授权</button>
            <button
              class="table-action"
              type="button"
              :disabled="togglePendingClientId === row.clientId"
              @click="toggleClient(row)"
            >
              {{ row.enabled ? '禁用' : '启用' }}
            </button>
          </div>
        </template>
      </DataTable>
      <Pagination
        v-if="totalElements > 0"
        :current="currentPage"
        :total="totalElements"
        :page-size="pageSize"
        @update:current="changePage"
        @update:page-size="changePageSize"
      />
    </section>
  </section>
</template>
